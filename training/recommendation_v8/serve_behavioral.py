from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Mapping

import torch

from common import FEATURE_CONTRACT, canonical_json, load_json, sha256_file
from model import build_model, collate_examples, model_config_from_json

MODEL_BUNDLE_CONTRACT = "model-bundle-v1"
MODEL_CONTRACT = "recommendation-behavioral-v8"
PROBABILITY_CONTRACT = "RAW_SOFTMAX_FEASIBLE_CHOICE_SET"
REQUEST_CONTRACT = "recommendation-behavioral-serving-request-v1"
RESPONSE_CONTRACT = "recommendation-behavioral-serving-response-v1"
READY_CONTRACT = "recommendation-behavioral-serving-ready-v1"
MAX_REQUEST_BYTES = 2 * 1024 * 1024


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve a verified immutable Behavioral V8 bundle")
    parser.add_argument("--bundle-dir", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8098)
    parser.add_argument("--device", default="cpu")
    return parser.parse_args()


class BehavioralRuntime:
    def __init__(self, bundle_dir: Path, device: str) -> None:
        self.bundle_dir = bundle_dir.resolve()
        self.manifest = verify_bundle(self.bundle_dir)
        self.manifest_sha256 = registry_manifest_sha256(self.manifest)
        self.device = resolve_device(device)
        checkpoint = torch.load(self.bundle_dir / "model.pt", map_location=self.device, weights_only=False)
        config = load_json(self.bundle_dir / "training-config.json")
        verify_checkpoint(checkpoint, self.manifest, config)
        self.model = build_model(model_config_from_json(config)).to(self.device)
        self.model.load_state_dict(checkpoint["stateDict"])
        self.model.eval()
        self.lock = threading.Lock()
        self.model_id = str(self.manifest["modelId"])
        self.model_version = str(self.manifest["modelVersion"])
        self.family = str(checkpoint["family"])
        self.feature_contract_version = str(self.manifest["featureContractVersion"])
        self.candidate_generator_version = str(self.manifest["candidateGeneratorVersion"])

    @torch.no_grad()
    def predict(self, payload: Mapping[str, Any]) -> Dict[str, Any]:
        started = time.perf_counter()
        if payload.get("contractVersion") != REQUEST_CONTRACT:
            raise ValueError("SERVING_REQUEST_CONTRACT_MISMATCH")
        if payload.get("modelVersion") != self.model_version:
            raise ValueError("SERVING_MODEL_VERSION_MISMATCH")
        if payload.get("candidateGeneratorVersion") != self.candidate_generator_version:
            raise ValueError("SERVING_CANDIDATE_GENERATOR_VERSION_MISMATCH")
        decision = payload.get("decision")
        if not isinstance(decision, dict):
            raise ValueError("SERVING_DECISION_REQUIRED")
        validate_decision(decision, self.feature_contract_version)
        candidates = decision["candidates"]
        example = {
            "state": decision["state"],
            "candidates": candidates,
            "observedActionKey": candidates[0]["actionKey"],
        }
        batch = collate_examples([example], self.model.config, self.device)
        with self.lock:
            scores = self.model(batch)
            probabilities = torch.softmax(scores, dim=1)[0, : len(candidates)].detach().cpu()
            raw_scores = scores[0, : len(candidates)].detach().cpu()
        scored = [
            {
                "actionKey": candidate["actionKey"],
                "score": float(raw_scores[index]),
                "probability": float(probabilities[index]),
            }
            for index, candidate in enumerate(candidates)
        ]
        ranked = sorted(scored, key=lambda item: (-item["probability"], item["actionKey"]))
        for index, item in enumerate(ranked):
            item["rank"] = index + 1
        probability_sum = sum(float(item["probability"]) for item in ranked)
        if not math.isfinite(probability_sum) or abs(probability_sum - 1.0) > 1e-6:
            raise RuntimeError(f"SERVING_PROBABILITY_VECTOR_NOT_NORMALIZED:{probability_sum}")
        entropy = -sum(
            float(item["probability"]) * math.log(max(float(item["probability"]), float.fromhex("0x1.0p-1022")))
            for item in ranked
            if float(item["probability"]) > 0
        )
        return {
            "contractVersion": RESPONSE_CONTRACT,
            "modelId": self.model_id,
            "modelVersion": self.model_version,
            "manifestSha256": self.manifest_sha256,
            "family": self.family,
            "featureContractVersion": self.feature_contract_version,
            "candidateGeneratorVersion": self.candidate_generator_version,
            "decisionId": decision["decisionId"],
            "probabilityContract": PROBABILITY_CONTRACT,
            "candidates": ranked,
            "entropy": entropy,
            "inferenceLatencyMs": (time.perf_counter() - started) * 1000.0,
            "probabilityFloorApplied": False,
        }

    def ready(self) -> Dict[str, Any]:
        return {
            "contractVersion": READY_CONTRACT,
            "ready": True,
            "modelId": self.model_id,
            "modelVersion": self.model_version,
            "manifestSha256": self.manifest_sha256,
            "family": self.family,
            "featureContractVersion": self.feature_contract_version,
            "candidateGeneratorVersion": self.candidate_generator_version,
            "device": str(self.device),
            "futureTestEvaluated": False,
        }


def main() -> int:
    args = parse_args()
    if not 1 <= args.port <= 65535:
        raise ValueError("port must be in [1,65535]")
    token = os.environ.get("RECOMMENDATION_BEHAVIORAL_SERVING_TOKEN", "").strip()
    if not is_loopback_host(args.host) and not token:
        raise ValueError("Non-loopback Behavioral serving requires RECOMMENDATION_BEHAVIORAL_SERVING_TOKEN")
    runtime = BehavioralRuntime(Path(args.bundle_dir), args.device)

    class Handler(BaseHTTPRequestHandler):
        server_version = "DeadlockBehavioralV8/1"

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/live":
                self.respond(HTTPStatus.OK, {"live": True})
                return
            if self.path == "/ready":
                if not self.authorized(token):
                    self.respond(HTTPStatus.UNAUTHORIZED, {"error": "UNAUTHORIZED"})
                    return
                self.respond(HTTPStatus.OK, runtime.ready())
                return
            self.respond(HTTPStatus.NOT_FOUND, {"error": "NOT_FOUND"})

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/predict":
                self.respond(HTTPStatus.NOT_FOUND, {"error": "NOT_FOUND"})
                return
            if not self.authorized(token):
                self.respond(HTTPStatus.UNAUTHORIZED, {"error": "UNAUTHORIZED"})
                return
            try:
                length = int(self.headers.get("content-length", "0"))
                if length <= 0 or length > MAX_REQUEST_BYTES:
                    raise ValueError("SERVING_REQUEST_SIZE_INVALID")
                raw = self.rfile.read(length)
                payload = json.loads(raw.decode("utf-8"))
                if not isinstance(payload, dict):
                    raise ValueError("SERVING_REQUEST_OBJECT_REQUIRED")
                self.respond(HTTPStatus.OK, runtime.predict(payload))
            except (ValueError, json.JSONDecodeError) as error:
                self.respond(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except Exception as error:  # fail closed without exposing stack or filesystem
                self.respond(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"SERVING_INFERENCE_FAILED:{type(error).__name__}"})

        def log_message(self, format: str, *args: Any) -> None:
            message = format % args
            print(json.dumps({"component": "behavioral-serving-v1", "message": message}), flush=True)

        def authorized(self, expected: str) -> bool:
            if not expected:
                return True
            provided = self.headers.get("authorization", "")
            if not provided.startswith("Bearer "):
                return False
            candidate = provided.removeprefix("Bearer ")
            return hashlib.sha256(candidate.encode()).digest() == hashlib.sha256(expected.encode()).digest()

        def respond(self, status: HTTPStatus, payload: Mapping[str, Any]) -> None:
            body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            self.send_response(int(status))
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(json.dumps({
        "status": "READY",
        "host": args.host,
        "port": args.port,
        "modelId": runtime.model_id,
        "modelVersion": runtime.model_version,
        "manifestSha256": runtime.manifest_sha256,
    }), flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
    return 0


def verify_bundle(bundle_dir: Path) -> Dict[str, Any]:
    manifest = load_json(bundle_dir / "manifest.json")
    errors = []
    if manifest.get("contractVersion") != MODEL_BUNDLE_CONTRACT:
        errors.append("MODEL_BUNDLE_CONTRACT_MISMATCH")
    if manifest.get("modelKind") != "BEHAVIORAL":
        errors.append("BEHAVIORAL_MODEL_KIND_REQUIRED")
    if manifest.get("futureTestEvaluated") is not False:
        errors.append("FUTURE_TEST_MODEL_FORBIDDEN")
    if manifest.get("featureContractVersion") != FEATURE_CONTRACT:
        errors.append("FEATURE_CONTRACT_MISMATCH")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        errors.append("MODEL_BUNDLE_FILES_REQUIRED")
        files = []
    seen = set()
    for descriptor in files:
        if not isinstance(descriptor, dict):
            errors.append("MODEL_BUNDLE_FILE_DESCRIPTOR_INVALID")
            continue
        relative = descriptor.get("path")
        if not isinstance(relative, str) or not safe_relative_path(relative):
            errors.append(f"MODEL_BUNDLE_PATH_INVALID:{relative}")
            continue
        if relative in seen:
            errors.append(f"MODEL_BUNDLE_DUPLICATE_PATH:{relative}")
        seen.add(relative)
        path = bundle_dir / relative
        if not path.is_file():
            errors.append(f"MODEL_BUNDLE_FILE_MISSING:{relative}")
            continue
        if sha256_file(path) != descriptor.get("sha256"):
            errors.append(f"MODEL_BUNDLE_FILE_SHA256_MISMATCH:{relative}")
        if path.stat().st_size != descriptor.get("sizeBytes"):
            errors.append(f"MODEL_BUNDLE_FILE_SIZE_MISMATCH:{relative}")
    for required in ("model.pt", "training-config.json", "model-metadata.json"):
        if required not in seen:
            errors.append(f"MODEL_BUNDLE_REQUIRED_FILE_MISSING:{required}")
    required_gates = {
        "BEHAVIORAL_OFFLINE",
        "BEHAVIORAL_SUPPORT",
        "BEHAVIORAL_MAJOR_COHORT_SUPPORT",
        "BEHAVIORAL_CANDIDATE_COVERAGE",
        "BEHAVIORAL_ILLEGAL_CANDIDATE_RATE",
        "NO_PROBABILITY_FLOOR",
        "RNN_TRANSFORMER_ABLATION",
        "FUTURE_TEST_UNTOUCHED",
    }
    gate_by_name = {
        gate.get("name"): gate
        for gate in manifest.get("gates", [])
        if isinstance(gate, dict) and isinstance(gate.get("name"), str)
    }
    for name in sorted(required_gates):
        if gate_by_name.get(name, {}).get("status") != "PASS":
            errors.append(f"MODEL_BUNDLE_REQUIRED_GATE_NOT_PASS:{name}")
    if errors:
        raise ValueError("Invalid Behavioral serving bundle: " + ",".join(sorted(set(errors))))
    return manifest


def verify_checkpoint(checkpoint: Mapping[str, Any], manifest: Mapping[str, Any], config: Mapping[str, Any]) -> None:
    expected = {
        "contract": MODEL_CONTRACT,
        "modelId": manifest["modelId"],
        "modelVersion": manifest["modelVersion"],
        "datasetSha256": manifest["datasetSha256"],
        "featureContractVersion": manifest["featureContractVersion"],
        "candidateGeneratorVersion": manifest["candidateGeneratorVersion"],
        "probabilityContract": PROBABILITY_CONTRACT,
        "futureTestEvaluated": False,
    }
    errors = [name for name, value in expected.items() if checkpoint.get(name) != value]
    if checkpoint.get("family") != config.get("family"):
        errors.append("family")
    if checkpoint.get("config") != dict(config):
        errors.append("config")
    if "stateDict" not in checkpoint:
        errors.append("stateDict")
    if errors:
        raise ValueError("Behavioral checkpoint identity mismatch: " + ",".join(sorted(set(errors))))


def validate_decision(decision: Mapping[str, Any], feature_contract: str) -> None:
    decision_id = decision.get("decisionId")
    state = decision.get("state")
    candidates = decision.get("candidates")
    if not isinstance(decision_id, str) or not decision_id:
        raise ValueError("SERVING_DECISION_ID_REQUIRED")
    if not isinstance(state, dict):
        raise ValueError("SERVING_STATE_REQUIRED")
    if state.get("contractVersion") != feature_contract:
        raise ValueError("SERVING_FEATURE_CONTRACT_MISMATCH")
    if state.get("decisionId") != decision_id:
        raise ValueError("SERVING_STATE_DECISION_ID_MISMATCH")
    if not isinstance(candidates, list) or not candidates:
        raise ValueError("SERVING_FEASIBLE_CANDIDATES_REQUIRED")
    keys = set()
    for candidate in candidates:
        if not isinstance(candidate, dict) or candidate.get("feasible") is not True:
            raise ValueError("SERVING_NON_FEASIBLE_CANDIDATE")
        key = candidate.get("actionKey")
        if not isinstance(key, str) or not key:
            raise ValueError("SERVING_ACTION_KEY_REQUIRED")
        if key in keys:
            raise ValueError(f"SERVING_DUPLICATE_ACTION_KEY:{key}")
        keys.add(key)


def registry_manifest_sha256(manifest: Mapping[str, Any]) -> str:
    canonical = dict(manifest)
    canonical["supportedRulesetVersions"] = sorted(list(manifest.get("supportedRulesetVersions", [])))
    canonical["supportedCatalogSha256"] = sorted(list(manifest.get("supportedCatalogSha256", [])))
    canonical["files"] = sorted(
        [dict(file) for file in manifest.get("files", []) if isinstance(file, dict)],
        key=lambda item: str(item.get("path", "")),
    )
    canonical["gates"] = sorted(
        [dict(gate) for gate in manifest.get("gates", []) if isinstance(gate, dict)],
        key=lambda item: str(item.get("name", "")),
    )
    serialized = json.dumps(canonical, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def resolve_device(value: str) -> torch.device:
    if value.startswith("cuda") and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested for serving but is not available")
    return torch.device(value)


def safe_relative_path(value: str) -> bool:
    path = Path(value)
    return bool(value) and not path.is_absolute() and ".." not in path.parts and all(path.parts)


def is_loopback_host(value: str) -> bool:
    return value in {"127.0.0.1", "::1", "localhost"}


if __name__ == "__main__":
    raise SystemExit(main())

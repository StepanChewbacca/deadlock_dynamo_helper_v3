from __future__ import annotations

import argparse
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from common import canonical_json, load_json, sha256_bytes, sha256_file, verify_dataset_manifest

MODEL_BUNDLE_CONTRACT = "model-bundle-v1"
ABLATION_CONTRACT = "recommendation-behavioral-ablation-v2"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build immutable Behavioral model bundle manifest")
    parser.add_argument("--training-output", required=True)
    parser.add_argument("--rnn-metrics", required=True)
    parser.add_argument("--dataset-dir", required=True)
    parser.add_argument("--ablation-report", required=True)
    parser.add_argument("--bundle-dir", required=True)
    parser.add_argument("--action-contract-version", required=True)
    parser.add_argument("--source-commit-sha", required=True)
    parser.add_argument("--training-wheelhouse-sha256")
    parser.add_argument("--training-readiness-subject-sha256")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    training_output = Path(args.training_output).resolve()
    rnn_metrics_path = Path(args.rnn_metrics).resolve()
    rnn_config_path = rnn_metrics_path.parent / "training-config.json"
    dataset_dir = Path(args.dataset_dir).resolve()
    ablation_path = Path(args.ablation_report).resolve()
    bundle_dir = Path(args.bundle_dir).resolve()
    if bundle_dir.exists() and any(bundle_dir.iterdir()):
        raise ValueError("Model bundle directory must be empty")
    bundle_dir.mkdir(parents=True, exist_ok=True)

    metrics_path = training_output / "metrics.json"
    config_path = training_output / "training-config.json"
    metrics = load_json(metrics_path)
    rnn_metrics = load_json(rnn_metrics_path)
    model_metadata = load_json(training_output / "model-metadata.json")
    config = load_json(config_path)
    rnn_config = load_json(rnn_config_path)
    ablation = load_json(ablation_path)
    dataset = verify_dataset_manifest(dataset_dir)

    if not is_git_sha(args.source_commit_sha):
        raise ValueError("sourceCommitSha must be a 40-character Git SHA")
    training_wheelhouse_sha256 = require_sha256_argument(
        args.training_wheelhouse_sha256 or os.environ.get("EXPECTED_WHEELHOUSE_SHA256", ""),
        "trainingWheelhouseSha256",
    )
    training_readiness_subject_sha256 = require_sha256_argument(
        args.training_readiness_subject_sha256 or os.environ.get("TRAINING_READINESS_SUBJECT_SHA256", ""),
        "trainingReadinessSubjectSha256",
    )
    dataset_manifest_sha256 = require_sha256_argument(
        str(dataset.get("_verifiedManifestSha256", "")),
        "datasetManifestSha256",
    )
    if str(dataset.get("sourceCommitSha", "")).lower() != args.source_commit_sha.lower():
        raise ValueError("MODEL_BUNDLE_SOURCE_COMMIT_DATASET_MISMATCH")
    if metrics.get("futureTestEvaluated") is not False or rnn_metrics.get("futureTestEvaluated") is not False:
        raise ValueError("FUTURE_TEST_MUST_REMAIN_UNTOUCHED_FOR_BEHAVIORAL_BUNDLE")
    if dataset.get("futureTestTouched") is not False:
        raise ValueError("DATASET_FUTURE_TEST_ALREADY_TOUCHED")
    if args.action_contract_version != dataset.get("actionContractVersion"):
        raise ValueError("ACTION_CONTRACT_VERSION_MISMATCH")
    if metrics.get("datasetSha256") != dataset.get("datasetSha256"):
        raise ValueError("MODEL_DATASET_SHA_MISMATCH")
    if metrics.get("manifestSha256") != dataset_manifest_sha256:
        raise ValueError("MODEL_DATASET_MANIFEST_SHA_MISMATCH")
    if metrics.get("featureContractVersion") != dataset.get("featureContractVersion"):
        raise ValueError("MODEL_FEATURE_CONTRACT_MISMATCH")
    if metrics.get("candidateGeneratorVersion") != dataset.get("candidateGeneratorVersion"):
        raise ValueError("MODEL_CANDIDATE_GENERATOR_MISMATCH")
    if not isinstance(metrics.get("environment"), dict) or not metrics["environment"]:
        raise ValueError("TRAINING_ENVIRONMENT_FINGERPRINT_REQUIRED")
    if ablation.get("version") != ABLATION_CONTRACT:
        raise ValueError("ABLATION_CONTRACT_MISMATCH")
    if ablation.get("datasetSha256") != dataset.get("datasetSha256"):
        raise ValueError("ABLATION_DATASET_SHA_MISMATCH")
    if ablation.get("featureContractVersion") != dataset.get("featureContractVersion"):
        raise ValueError("ABLATION_FEATURE_CONTRACT_MISMATCH")
    if ablation.get("candidateGeneratorVersion") != dataset.get("candidateGeneratorVersion"):
        raise ValueError("ABLATION_CANDIDATE_GENERATOR_MISMATCH")
    if ablation.get("rnnMetricsSha256") != sha256_file(rnn_metrics_path):
        raise ValueError("ABLATION_RNN_METRICS_SHA_MISMATCH")
    if ablation.get("transformerMetricsSha256") != sha256_file(metrics_path):
        raise ValueError("ABLATION_TRANSFORMER_METRICS_SHA_MISMATCH")
    rnn_config_sha = sha256_bytes(canonical_json(rnn_config).encode("utf-8"))
    transformer_config_sha = sha256_bytes(canonical_json(config).encode("utf-8"))
    if rnn_metrics.get("trainingConfigSha256") != rnn_config_sha:
        raise ValueError("RNN_TRAINING_CONFIG_SHA_MISMATCH")
    if metrics.get("trainingConfigSha256") != transformer_config_sha:
        raise ValueError("TRANSFORMER_TRAINING_CONFIG_SHA_MISMATCH")
    if ablation.get("rnnTrainingConfigSha256") != rnn_config_sha:
        raise ValueError("ABLATION_RNN_CONFIG_SHA_MISMATCH")
    if ablation.get("transformerTrainingConfigSha256") != transformer_config_sha:
        raise ValueError("ABLATION_TRANSFORMER_CONFIG_SHA_MISMATCH")
    if ablation.get("passed") is not True:
        raise ValueError("RNN_TRANSFORMER_ABLATION_NOT_PASS")
    if metrics.get("family") != "SEQUENCE_TRANSFORMER":
        raise ValueError("BUILDLM_BUNDLE_REQUIRES_TRANSFORMER_WINNER")
    if rnn_metrics.get("family") != "SEQUENCE_RNN":
        raise ValueError("ABLATION_RNN_FAMILY_REQUIRED")
    behavioral_gate = metrics.get("behavioralGate", {})
    if not isinstance(behavioral_gate, dict) or behavioral_gate.get("passed") is not True:
        raise ValueError("BEHAVIORAL_OFFLINE_GATE_NOT_PASS")
    if model_metadata.get("family") != metrics.get("family"):
        raise ValueError("MODEL_METADATA_FAMILY_MISMATCH")
    if model_metadata.get("modelId") != metrics.get("modelId") or model_metadata.get("modelVersion") != metrics.get("modelVersion"):
        raise ValueError("MODEL_METADATA_IDENTITY_MISMATCH")
    if model_metadata.get("featureContractVersion") != dataset.get("featureContractVersion"):
        raise ValueError("MODEL_METADATA_FEATURE_CONTRACT_MISMATCH")
    if model_metadata.get("candidateGeneratorVersion") != dataset.get("candidateGeneratorVersion"):
        raise ValueError("MODEL_METADATA_CANDIDATE_GENERATOR_MISMATCH")
    if config.get("family") != metrics.get("family"):
        raise ValueError("TRAINING_CONFIG_FAMILY_MISMATCH")
    if rnn_config.get("family") != rnn_metrics.get("family"):
        raise ValueError("RNN_TRAINING_CONFIG_FAMILY_MISMATCH")

    thresholds = behavioral_gate.get("thresholds")
    if not isinstance(thresholds, dict):
        raise ValueError("BEHAVIORAL_GATE_THRESHOLDS_REQUIRED")
    min_support = required_number(thresholds, "minSupport")
    min_major_cohort_support = required_number(thresholds, "minMajorCohortSupport")
    min_candidate_coverage = required_number(thresholds, "minCandidateCoverage")
    max_floor_sensitivity = required_number(thresholds, "maxFloorSensitivity")

    source_files = [
        (training_output / "model.pt", "model.pt"),
        (metrics_path, "metrics.json"),
        (config_path, "training-config.json"),
        (training_output / "model-metadata.json", "model-metadata.json"),
        (rnn_metrics_path, "ablation/rnn-metrics.json"),
        (rnn_config_path, "ablation/rnn-training-config.json"),
        (ablation_path, "ablation-report.json"),
    ]
    files = []
    for source, relative in source_files:
        if not source.is_file():
            raise ValueError(f"Required model artifact is missing: {source}")
        target = bundle_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        files.append({
            "path": relative,
            "sha256": sha256_file(target),
            "sizeBytes": target.stat().st_size,
        })

    shadow = metrics["shadowHoldout"]
    gates = [
        gate("BEHAVIORAL_OFFLINE", behavioral_gate.get("passed") is True, shadow["rawLogLoss"], f"<{shadow['baselineRawLogLoss']}"),
        gate("BEHAVIORAL_SUPPORT", shadow["support"] >= min_support, shadow["support"], f">={min_support}"),
        gate(
            "BEHAVIORAL_MAJOR_COHORT_SUPPORT",
            shadow["majorCohortSupportMin"] >= min_major_cohort_support,
            shadow["majorCohortSupportMin"],
            f">={min_major_cohort_support}",
        ),
        gate(
            "BEHAVIORAL_CANDIDATE_COVERAGE",
            shadow["candidateCoverage"] >= min_candidate_coverage,
            shadow["candidateCoverage"],
            f">={min_candidate_coverage}",
        ),
        gate("BEHAVIORAL_ILLEGAL_CANDIDATE_RATE", shadow["illegalCandidateRate"] == 0, shadow["illegalCandidateRate"], "=0"),
        gate("NO_PROBABILITY_FLOOR", shadow["probabilityFloorApplied"] is False, shadow["probabilityFloorApplied"], False),
        gate("BEHAVIORAL_FLOOR_SENSITIVITY", shadow["floorSensitivity"] <= max_floor_sensitivity, shadow["floorSensitivity"], f"<={max_floor_sensitivity}"),
        gate("RNN_TRANSFORMER_ABLATION", ablation["passed"] is True, ablation["transformerLogLossImprovement"], ">=configured-ablation-threshold"),
        gate("FUTURE_TEST_UNTOUCHED", True, False, False),
    ]
    if not all(item["status"] == "PASS" for item in gates):
        failed = [item["name"] for item in gates if item["status"] != "PASS"]
        raise ValueError("Model bundle gate failure: " + ",".join(failed))

    manifest = {
        "contractVersion": MODEL_BUNDLE_CONTRACT,
        "modelId": metrics["modelId"],
        "modelVersion": metrics["modelVersion"],
        "modelKind": "BEHAVIORAL",
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceCommitSha": args.source_commit_sha.lower(),
        "datasetId": dataset["datasetId"],
        "datasetSha256": dataset["datasetSha256"],
        "datasetManifestSha256": dataset_manifest_sha256,
        "trainingWheelhouseSha256": training_wheelhouse_sha256,
        "trainingReadinessSubjectSha256": training_readiness_subject_sha256,
        "featureContractVersion": dataset["featureContractVersion"],
        "actionContractVersion": dataset["actionContractVersion"],
        "candidateGeneratorVersion": dataset["candidateGeneratorVersion"],
        "supportedRulesetVersions": sorted(dataset["supportedRulesetVersions"]),
        "supportedCatalogSha256": sorted(dataset["supportedCatalogSha256"]),
        "trainingConfigSha256": metrics["trainingConfigSha256"],
        "files": sorted(files, key=lambda item: item["path"]),
        "gates": sorted(gates, key=lambda item: item["name"]),
        "futureTestEvaluated": False,
        "notes": "Behavioral BuildLM candidate produced from TRAIN/VALIDATION/SHADOW_HOLDOUT only. Exact dataset manifest, pretraining readiness subject, wheelhouse, RNN ablation metrics/config, and runtime fingerprint lineage are immutable. FUTURE_TEST was not decoded or evaluated by the trainer.",
    }
    with (bundle_dir / "manifest.json").open("x", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps({"status": "PASS", "manifest": str(bundle_dir / "manifest.json")}))
    return 0


def gate(name: str, passed: bool, value: Any, threshold: Any) -> Dict[str, Any]:
    return {
        "name": name,
        "status": "PASS" if passed else "FAIL",
        "value": value,
        "threshold": threshold,
    }


def required_number(values: Dict[str, Any], name: str) -> float:
    value = values.get(name)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Behavioral gate threshold is invalid: {name}")
    return float(value)


def require_sha256_argument(value: str, name: str) -> str:
    if len(value) != 64 or any(character not in "0123456789abcdefABCDEF" for character in value):
        raise ValueError(f"{name} must be a SHA256")
    return value.lower()


def is_git_sha(value: str) -> bool:
    return len(value) == 40 and all(character in "0123456789abcdefABCDEF" for character in value)


if __name__ == "__main__":
    raise SystemExit(main())

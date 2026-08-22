from __future__ import annotations

import argparse
import importlib.metadata
import json
import math
import os
import platform
import sys
from pathlib import Path
from typing import Any, Dict, Mapping

EXPECTED_PYTHON = (3, 12)
ALLOWED_CUBLAS_WORKSPACE_CONFIGS = (":4096:8", ":16:8")
REQUIRED_EQUAL_OBSERVABLE_KEYS = (
    "seed",
    "deterministic",
    "trainSplit",
    "validationSplit",
    "selectionSplit",
    "futureTestAllowed",
    "maximumHistoryEvents",
    "hashDimension",
    "embeddingDimension",
    "hiddenDimension",
    "layerCount",
    "dropout",
    "supportProbabilityThreshold",
    "majorCohortMinDecisions",
    "majorCohortMinFraction",
    "gateMinDecisions",
    "gateMinCandidateCoverage",
    "gateMinSupport",
    "gateMinMajorCohortSupport",
    "gateMaxFloorSensitivity",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fail-closed Behavioral V8 training environment readiness check")
    parser.add_argument("--rnn-config", default="training/recommendation_v8/config/rnn.json")
    parser.add_argument("--transformer-config", default="training/recommendation_v8/config/transformer.json")
    parser.add_argument("--requirements", default="training/recommendation_v8/requirements-training.txt")
    parser.add_argument("--static-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    rnn = load_json(Path(args.rnn_config))
    transformer = load_json(Path(args.transformer_config))
    blockers = validate_configs(rnn, transformer)
    expected_requirements = pinned_requirements(Path(args.requirements), blockers)

    runtime: Dict[str, Any] = {
        "pythonVersion": platform.python_version(),
        "staticOnly": bool(args.static_only),
    }
    if sys.version_info[:2] != EXPECTED_PYTHON:
        blockers.append(f"PYTHON_VERSION_MUST_BE_{EXPECTED_PYTHON[0]}_{EXPECTED_PYTHON[1]}")

    if not args.static_only:
        blockers.extend(validate_installed_requirements(expected_requirements, runtime))
        blockers.extend(validate_training_device(rnn, transformer, runtime))

    report = {
        "contractVersion": "recommendation-pretraining-environment-v1",
        "ready": not blockers,
        "blockers": sorted(set(blockers)),
        "runtime": runtime,
        "equalObservableKeys": list(REQUIRED_EQUAL_OBSERVABLE_KEYS),
        "futureTestAllowed": False,
    }
    print(json.dumps(report, sort_keys=True))
    return 0 if report["ready"] else 2


def validate_configs(rnn: Mapping[str, Any], transformer: Mapping[str, Any]) -> list[str]:
    blockers: list[str] = []
    if rnn.get("family") != "SEQUENCE_RNN":
        blockers.append("RNN_FAMILY_INVALID")
    if transformer.get("family") != "SEQUENCE_TRANSFORMER":
        blockers.append("TRANSFORMER_FAMILY_INVALID")
    for name, config in (("RNN", rnn), ("TRANSFORMER", transformer)):
        if config.get("contractVersion") != "recommendation-behavioral-training-launch-v1":
            blockers.append(f"{name}_CONTRACT_INVALID")
        if config.get("deterministic") is not True:
            blockers.append(f"{name}_DETERMINISTIC_REQUIRED")
        if config.get("trainSplit") != "TRAIN":
            blockers.append(f"{name}_TRAIN_SPLIT_INVALID")
        if config.get("validationSplit") != "VALIDATION":
            blockers.append(f"{name}_VALIDATION_SPLIT_INVALID")
        if config.get("selectionSplit") != "SHADOW_HOLDOUT":
            blockers.append(f"{name}_SELECTION_SPLIT_INVALID")
        if config.get("futureTestAllowed") is not False:
            blockers.append(f"{name}_FUTURE_TEST_MUST_BE_BLOCKED")
        device = config.get("device")
        if not isinstance(device, str) or not device.strip():
            blockers.append(f"{name}_DEVICE_INVALID")

    for key in REQUIRED_EQUAL_OBSERVABLE_KEYS:
        if rnn.get(key) != transformer.get(key):
            blockers.append(f"EQUAL_OBSERVABLES_MISMATCH:{key}")
    heads = transformer.get("attentionHeads")
    hidden = transformer.get("hiddenDimension")
    if not isinstance(heads, int) or heads <= 0:
        blockers.append("TRANSFORMER_ATTENTION_HEADS_INVALID")
    elif not isinstance(hidden, int) or hidden <= 0 or hidden % heads != 0:
        blockers.append("TRANSFORMER_HIDDEN_DIMENSION_NOT_DIVISIBLE_BY_HEADS")
    return blockers


def pinned_requirements(path: Path, blockers: list[str]) -> Dict[str, str]:
    if not path.is_file():
        blockers.append("TRAINING_REQUIREMENTS_MISSING")
        return {}
    result: Dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "==" not in line or line.count("==") != 1:
            blockers.append(f"TRAINING_REQUIREMENT_NOT_EXACTLY_PINNED:{line}")
            continue
        name, version = line.split("==", 1)
        if not name or not version:
            blockers.append(f"TRAINING_REQUIREMENT_INVALID:{line}")
            continue
        result[name.lower()] = version
    if not result:
        blockers.append("TRAINING_REQUIREMENTS_EMPTY")
    return result


def validate_installed_requirements(expected: Mapping[str, str], runtime: Dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    installed: Dict[str, str] = {}
    for name, version in expected.items():
        try:
            actual = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            blockers.append(f"TRAINING_DEPENDENCY_MISSING:{name}")
            continue
        installed[name] = actual
        if actual != version:
            blockers.append(f"TRAINING_DEPENDENCY_VERSION_MISMATCH:{name}:{actual}!={version}")
    runtime["installedTrainingDependencies"] = dict(sorted(installed.items()))
    return blockers


def validate_training_device(
    rnn: Mapping[str, Any],
    transformer: Mapping[str, Any],
    runtime: Dict[str, Any],
) -> list[str]:
    blockers: list[str] = []
    try:
        import torch
    except Exception as error:  # noqa: BLE001
        runtime["torchImportError"] = type(error).__name__
        return ["TORCH_IMPORT_FAILED"]

    requested = {str(rnn.get("device", "")), str(transformer.get("device", ""))}
    runtime["requestedDevices"] = sorted(requested)
    runtime["torchVersion"] = str(torch.__version__)
    runtime["cudaAvailable"] = bool(torch.cuda.is_available())
    runtime["cudaDeviceCount"] = int(torch.cuda.device_count()) if torch.cuda.is_available() else 0
    runtime["cudaDevices"] = [
        torch.cuda.get_device_name(index)
        for index in range(torch.cuda.device_count())
    ] if torch.cuda.is_available() else []
    runtime["cudaCapabilities"] = [
        list(torch.cuda.get_device_capability(index))
        for index in range(torch.cuda.device_count())
    ] if torch.cuda.is_available() else []
    runtime["cublasWorkspaceConfig"] = os.environ.get("CUBLAS_WORKSPACE_CONFIG")
    runtime["pythonHashSeed"] = os.environ.get("PYTHONHASHSEED")

    if any(device.startswith("cuda") for device in requested):
        if not torch.cuda.is_available() or torch.cuda.device_count() <= 0:
            blockers.append("CUDA_REQUESTED_BUT_UNAVAILABLE")
        if os.environ.get("CUBLAS_WORKSPACE_CONFIG") not in ALLOWED_CUBLAS_WORKSPACE_CONFIGS:
            blockers.append("CUBLAS_WORKSPACE_CONFIG_REQUIRED_FOR_DETERMINISM")
        if os.environ.get("PYTHONHASHSEED") is None:
            blockers.append("PYTHONHASHSEED_REQUIRED_FOR_DETERMINISM")
    for device in requested:
        try:
            torch.device(device)
        except Exception:  # noqa: BLE001
            blockers.append(f"TRAINING_DEVICE_INVALID:{device}")

    if not blockers and any(device.startswith("cuda") for device in requested):
        blockers.extend(run_cuda_determinism_smoke(torch, int(rnn.get("seed", 0)), runtime))
    return blockers


def run_cuda_determinism_smoke(torch: Any, seed: int, runtime: Dict[str, Any]) -> list[str]:
    try:
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        torch.use_deterministic_algorithms(True, warn_only=False)
        device = torch.device("cuda:0")
        left = torch.arange(1, 17, dtype=torch.float32, device=device).reshape(4, 4).requires_grad_(True)
        right = torch.arange(17, 33, dtype=torch.float32, device=device).reshape(4, 4)
        output = (left @ right).square().mean()
        output.backward()
        torch.cuda.synchronize(device)
        value = float(output.detach().cpu())
        gradient_norm = float(left.grad.detach().norm().cpu()) if left.grad is not None else math.nan
        runtime["cudaDeterminismSmoke"] = {
            "passed": math.isfinite(value) and math.isfinite(gradient_norm),
            "value": value,
            "gradientNorm": gradient_norm,
        }
        if not runtime["cudaDeterminismSmoke"]["passed"]:
            return ["CUDA_DETERMINISM_SMOKE_NONFINITE"]
        return []
    except Exception as error:  # noqa: BLE001
        runtime["cudaDeterminismSmoke"] = {
            "passed": False,
            "errorType": type(error).__name__,
        }
        return ["CUDA_DETERMINISM_SMOKE_FAILED"]


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import gzip
import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Mapping, Sequence

DATASET_MANIFEST_CONTRACT = "recommendation-dataset-manifest-v1"
TRAINING_EXAMPLE_CONTRACT = "recommendation-behavioral-training-example-v1"
FEATURE_CONTRACT = "recommendation-features-v8"
ALLOWED_TRAINING_SPLITS = ("TRAIN", "VALIDATION", "SHADOW_HOLDOUT")
FORBIDDEN_TRAINING_SPLIT = "FUTURE_TEST"


def canonical_json(value: Any) -> str:
    if value is None or isinstance(value, (bool, int, float, str)):
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False) + ":" + canonical_json(value[key])
            for key in sorted(value)
        ) + "}"
    raise TypeError(f"Unsupported canonical JSON type: {type(value)!r}")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_size(path: Path) -> int:
    return path.stat().st_size


def load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected JSON object: {path}")
    return value


def verify_dataset_manifest(
    dataset_dir: Path,
    expected_dataset_sha256: str | None = None,
    expected_manifest_sha256: str | None = None,
) -> Dict[str, Any]:
    manifest_path = dataset_dir / "manifest.json"
    manifest = load_json(manifest_path)
    errors: List[str] = []

    if manifest.get("contractVersion") != DATASET_MANIFEST_CONTRACT:
        errors.append("DATASET_MANIFEST_CONTRACT_MISMATCH")
    if manifest.get("featureContractVersion") != FEATURE_CONTRACT:
        errors.append("FEATURE_CONTRACT_MISMATCH")
    if manifest.get("pointInTimeCorrect") is not True:
        errors.append("POINT_IN_TIME_CORRECTNESS_REQUIRED")
    if manifest.get("observedActionInjected") is not False:
        errors.append("OBSERVED_ACTION_INJECTION_FORBIDDEN")
    if manifest.get("futureTestTouched") is not False:
        errors.append("FUTURE_TEST_ALREADY_TOUCHED")

    dataset_sha = manifest.get("datasetSha256")
    if not is_sha256(dataset_sha):
        errors.append("DATASET_SHA256_INVALID")
    manifest_without_dataset_sha = dict(manifest)
    manifest_without_dataset_sha.pop("datasetSha256", None)
    calculated_dataset_sha = sha256_bytes(canonical_json(manifest_without_dataset_sha).encode("utf-8"))
    if dataset_sha != calculated_dataset_sha:
        errors.append("DATASET_SHA256_MISMATCH")
    if expected_dataset_sha256 and dataset_sha != expected_dataset_sha256:
        errors.append("EXPECTED_DATASET_SHA256_MISMATCH")

    calculated_manifest_sha = sha256_bytes(canonical_json(manifest).encode("utf-8"))
    if expected_manifest_sha256 and calculated_manifest_sha != expected_manifest_sha256:
        errors.append("EXPECTED_MANIFEST_SHA256_MISMATCH")

    splits = manifest.get("splits")
    if not isinstance(splits, list):
        errors.append("DATASET_SPLITS_REQUIRED")
        splits = []
    split_names = [entry.get("split") for entry in splits if isinstance(entry, dict)]
    if split_names != ["TRAIN", "VALIDATION", "SHADOW_HOLDOUT", "FUTURE_TEST"]:
        errors.append("DATASET_SPLIT_ORDER_INVALID")
    for entry in splits:
        if not isinstance(entry, dict):
            continue
        split = entry.get("split")
        if split == FORBIDDEN_TRAINING_SPLIT:
            if entry.get("sealed") is not True:
                errors.append("FUTURE_TEST_MUST_BE_SEALED")
            if entry.get("matchCount") != 0 or entry.get("decisionCount") != 0:
                errors.append("FUTURE_TEST_COUNTS_MUST_BE_HIDDEN")
        elif split in ALLOWED_TRAINING_SPLITS and entry.get("sealed") is not False:
            errors.append(f"DEVELOPMENT_SPLIT_MUST_BE_UNSEALED:{split}")
    assert_split_chronology(splits, errors)

    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        errors.append("DATASET_FILES_REQUIRED")
        files = []
    seen_paths: set[str] = set()
    development_file_counts = {split: 0 for split in ALLOWED_TRAINING_SPLITS}
    for descriptor in files:
        if not isinstance(descriptor, dict):
            errors.append("DATASET_FILE_DESCRIPTOR_INVALID")
            continue
        relative = descriptor.get("path")
        if not isinstance(relative, str) or not safe_relative_path(relative):
            errors.append(f"DATASET_FILE_PATH_INVALID:{relative}")
            continue
        normalized = relative.replace("\\", "/")
        if normalized.endswith("future_test.jsonl.gz"):
            errors.append("FUTURE_TEST_ARTIFACT_FORBIDDEN_DURING_MODEL_DEVELOPMENT")
        for split in ALLOWED_TRAINING_SPLITS:
            if normalized.endswith(split.lower() + ".jsonl.gz"):
                development_file_counts[split] += 1
        if relative in seen_paths:
            errors.append(f"DATASET_FILE_DUPLICATE:{relative}")
        seen_paths.add(relative)
        path = dataset_dir / relative
        if not path.is_file():
            errors.append(f"DATASET_FILE_MISSING:{relative}")
            continue
        expected_sha = descriptor.get("sha256")
        if sha256_file(path) != expected_sha:
            errors.append(f"DATASET_FILE_SHA256_MISMATCH:{relative}")
        if file_size(path) != descriptor.get("sizeBytes"):
            errors.append(f"DATASET_FILE_SIZE_MISMATCH:{relative}")
    for split, count in development_file_counts.items():
        if count != 1:
            errors.append(f"DEVELOPMENT_SPLIT_ARTIFACT_COUNT_INVALID:{split}:{count}")

    if errors:
        raise ValueError("Invalid immutable dataset: " + ",".join(sorted(set(errors))))
    manifest["_verifiedManifestSha256"] = calculated_manifest_sha
    return manifest


def split_file(manifest: Mapping[str, Any], split: str) -> str:
    if split == FORBIDDEN_TRAINING_SPLIT:
        raise ValueError("FUTURE_TEST_ACCESS_FORBIDDEN_DURING_MODEL_DEVELOPMENT")
    if split not in ALLOWED_TRAINING_SPLITS:
        raise ValueError(f"Unknown training split: {split}")
    suffix = split.lower() + ".jsonl.gz"
    candidates = [entry for entry in manifest.get("files", []) if isinstance(entry, dict)]
    matches = [entry["path"] for entry in candidates if str(entry.get("path", "")).endswith(suffix)]
    if len(matches) != 1:
        raise ValueError(f"Expected exactly one artifact for split {split}, found {len(matches)}")
    return matches[0]


def iter_examples(dataset_dir: Path, manifest: Mapping[str, Any], split: str) -> Iterator[Dict[str, Any]]:
    relative = split_file(manifest, split)
    path = dataset_dir / relative
    expected_rows = next(
        int(entry.get("rowCount", 0))
        for entry in manifest.get("files", [])
        if isinstance(entry, dict) and entry.get("path") == relative
    )
    row_count = 0
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            row_count += 1
            value = json.loads(line)
            validate_training_example(value, split, manifest, line_number)
            yield value
    if row_count != expected_rows:
        raise ValueError(f"ROW_COUNT_MISMATCH:{split}:expected={expected_rows}:actual={row_count}")


def validate_training_example(
    example: Mapping[str, Any],
    split: str,
    manifest: Mapping[str, Any],
    line_number: int,
) -> None:
    errors: List[str] = []
    if split == FORBIDDEN_TRAINING_SPLIT:
        errors.append("FUTURE_TEST_ACCESS_FORBIDDEN_DURING_MODEL_DEVELOPMENT")
    if example.get("contractVersion") != TRAINING_EXAMPLE_CONTRACT:
        errors.append("TRAINING_EXAMPLE_CONTRACT_MISMATCH")
    if example.get("split") != split:
        errors.append("TRAINING_SPLIT_MISMATCH")
    if example.get("observedActionInjected") is not False:
        errors.append("OBSERVED_ACTION_INJECTION_FORBIDDEN")
    if example.get("candidateGeneratorVersion") != manifest.get("candidateGeneratorVersion"):
        errors.append("CANDIDATE_GENERATOR_VERSION_MISMATCH")

    state = example.get("state")
    if not isinstance(state, dict):
        errors.append("STATE_REQUIRED")
    else:
        if state.get("contractVersion") != FEATURE_CONTRACT:
            errors.append("FEATURE_CONTRACT_MISMATCH")
        if state.get("decisionId") != example.get("decisionId"):
            errors.append("STATE_DECISION_ID_MISMATCH")
        if state.get("matchId") != example.get("matchId"):
            errors.append("STATE_MATCH_ID_MISMATCH")
        decision_at = finite_number(state.get("decisionAtMs"))
        source_at = finite_number(state.get("stateSourceAtMs"))
        if decision_at is None or source_at is None or source_at > decision_at:
            errors.append("FUTURE_STATE_LEAKAGE")
        history = state.get("history")
        if not isinstance(history, list):
            errors.append("HISTORY_REQUIRED")
        elif decision_at is not None:
            previous = -math.inf
            for index, event in enumerate(history):
                if not isinstance(event, dict):
                    errors.append(f"HISTORY_EVENT_INVALID:{index}")
                    continue
                occurred = finite_number(event.get("occurredAtMs"))
                if occurred is None or occurred >= decision_at:
                    errors.append(f"NON_CAUSAL_HISTORY_EVENT:{index}")
                if occurred is not None and occurred < previous:
                    errors.append(f"HISTORY_ORDER_INVALID:{index}")
                if occurred is not None:
                    previous = occurred
        ruleset = state.get("rulesetVersion")
        catalog = state.get("catalogSha256")
        if ruleset not in manifest.get("supportedRulesetVersions", []):
            errors.append("RULESET_NOT_IN_DATASET_MANIFEST")
        if catalog not in manifest.get("supportedCatalogSha256", []):
            errors.append("CATALOG_NOT_IN_DATASET_MANIFEST")

    candidates = example.get("candidates")
    observed = example.get("observedActionKey")
    if not isinstance(candidates, list) or not candidates:
        errors.append("FEASIBLE_CHOICE_SET_EMPTY")
    else:
        keys: set[str] = set()
        for candidate in candidates:
            if not isinstance(candidate, dict):
                errors.append("CANDIDATE_INVALID")
                continue
            key = candidate.get("actionKey")
            if not isinstance(key, str) or not key:
                errors.append("CANDIDATE_ACTION_KEY_REQUIRED")
            elif key in keys:
                errors.append(f"DUPLICATE_CANDIDATE:{key}")
            else:
                keys.add(key)
            if candidate.get("feasible") is not True:
                errors.append(f"NON_FEASIBLE_CANDIDATE:{key}")
        if observed not in keys:
            errors.append("OBSERVED_ACTION_OUTSIDE_FEASIBLE_SET")

    if errors:
        raise ValueError(f"Invalid training example {split}:{line_number}:" + ",".join(sorted(set(errors))))


def state_tokens(state: Mapping[str, Any]) -> List[str]:
    tokens = [
        f"HERO:{int(state['heroId'])}",
        f"TIME5M:{int(float(state['gameTimeSec']) // 300)}",
        f"SHOP:{state['shopOpportunity']}",
        f"RULESET:{state['rulesetVersion']}",
    ]
    if state.get("teamId") is not None:
        tokens.append(f"TEAM:{int(state['teamId'])}")
    if state.get("level") is not None:
        tokens.append(f"LEVEL3:{int(float(state['level']) // 3)}")
    if state.get("healthFraction") is not None:
        bucket = min(9, int(float(state["healthFraction"]) * 10))
        tokens.append(f"HEALTH10:{bucket}")
    if state.get("verifiedSpendableSouls") is not None:
        tokens.append(f"WALLET800:{int(float(state['verifiedSpendableSouls']) // 800)}")
    else:
        tokens.append("WALLET:UNKNOWN")
    for item in sorted(state.get("inventory", []), key=lambda value: int(value["itemId"])):
        tokens.append(f"OWNED:{int(item['itemId'])}")
    return tokens


def history_tokens(state: Mapping[str, Any], maximum_events: int) -> List[str]:
    events = list(state.get("history", []))[-maximum_events:] if maximum_events > 0 else []
    result: List[str] = []
    for event in events:
        result.append(f"EVENT:{event['eventType']}")
        if event.get("actionKey"):
            result.append(f"EVENT_ACTION:{event['actionKey']}")
        if event.get("itemId") is not None:
            result.append(f"EVENT_ITEM:{int(event['itemId'])}")
    return result


def action_tokens(action: Mapping[str, Any]) -> List[str]:
    tokens = [f"ACTION:{action['actionType']}", f"ACTION_KEY:{action['actionKey']}"]
    if action.get("targetItemId") is not None:
        tokens.append(f"TARGET_ITEM:{int(action['targetItemId'])}")
    if action.get("sellItemId") is not None:
        tokens.append(f"SELL_ITEM:{int(action['sellItemId'])}")
    if action.get("recipeId"):
        tokens.append(f"RECIPE:{action['recipeId']}")
    tokens.append(f"COST800:{math.trunc(float(action['effectiveCostSouls']) / 800)}")
    return tokens


def fnv1a_index(token: str, dimension: int) -> int:
    if dimension < 2:
        raise ValueError("hash dimension must be >= 2")
    value = 2166136261
    for byte in token.encode("utf-8"):
        value ^= byte
        value = (value * 16777619) & 0xFFFFFFFF
    return 1 + (value % (dimension - 1))


def phase_cohort(game_time_sec: float) -> str:
    if game_time_sec < 600:
        return "early"
    if game_time_sec < 1200:
        return "mid"
    return "late"


def major_cohort_key(example: Mapping[str, Any]) -> str:
    state = example["state"]
    return f"hero:{int(state['heroId'])}|phase:{phase_cohort(float(state['gameTimeSec']))}"


def is_sha256(value: Any) -> bool:
    if not isinstance(value, str) or len(value) != 64:
        return False
    return all(character in "0123456789abcdefABCDEF" for character in value)


def finite_number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    parsed = float(value)
    return parsed if math.isfinite(parsed) else None


def safe_relative_path(value: str) -> bool:
    path = Path(value)
    return bool(value) and not path.is_absolute() and ".." not in path.parts and all(part for part in path.parts)


def assert_split_chronology(splits: Sequence[Any], errors: List[str]) -> None:
    previous_to: float | None = None
    for entry in splits:
        if not isinstance(entry, dict):
            continue
        try:
            from_timestamp = parse_iso(entry["from"])
            to_timestamp = parse_iso(entry["to"])
        except (KeyError, ValueError, TypeError):
            errors.append(f"SPLIT_TIME_INVALID:{entry.get('split')}")
            continue
        if from_timestamp >= to_timestamp:
            errors.append(f"SPLIT_RANGE_INVALID:{entry.get('split')}")
        if previous_to is not None and previous_to > from_timestamp:
            errors.append(f"SPLIT_CHRONOLOGY_VIOLATION:{entry.get('split')}")
        previous_to = to_timestamp


def parse_iso(value: str) -> float:
    from datetime import datetime

    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized).timestamp()


@dataclass(frozen=True)
class DatasetIdentity:
    dataset_id: str
    dataset_sha256: str
    manifest_sha256: str
    feature_contract_version: str
    candidate_generator_version: str


def dataset_identity(manifest: Mapping[str, Any]) -> DatasetIdentity:
    return DatasetIdentity(
        dataset_id=str(manifest["datasetId"]),
        dataset_sha256=str(manifest["datasetSha256"]),
        manifest_sha256=str(manifest["_verifiedManifestSha256"]),
        feature_contract_version=str(manifest["featureContractVersion"]),
        candidate_generator_version=str(manifest["candidateGeneratorVersion"]),
    )

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping

from common import ALLOWED_TRAINING_SPLITS, finite_number, iter_examples, parse_iso


def verify_development_split_isolation(dataset_dir: Path, manifest: Mapping[str, Any]) -> None:
    examples_by_split = {
        split: iter_examples(dataset_dir, manifest, split)
        for split in ALLOWED_TRAINING_SPLITS
    }
    errors = audit_development_split_isolation(manifest, examples_by_split)
    if errors:
        raise ValueError("Invalid pre-training split isolation: " + ",".join(errors))


def audit_development_split_isolation(
    manifest: Mapping[str, Any],
    examples_by_split: Mapping[str, Iterable[Mapping[str, Any]]],
) -> List[str]:
    errors: List[str] = []
    descriptors = {
        entry.get("split"): entry
        for entry in manifest.get("splits", [])
        if isinstance(entry, dict) and isinstance(entry.get("split"), str)
    }
    match_owner: Dict[str, str] = {}
    decision_owner: Dict[str, str] = {}

    for split in ALLOWED_TRAINING_SPLITS:
        descriptor = descriptors.get(split)
        if not isinstance(descriptor, dict):
            errors.append(f"SPLIT_DESCRIPTOR_MISSING:{split}")
            continue
        try:
            from_ms = parse_iso(str(descriptor["from"])) * 1000.0
            to_ms = parse_iso(str(descriptor["to"])) * 1000.0
        except (KeyError, TypeError, ValueError):
            errors.append(f"SPLIT_TIME_INVALID:{split}")
            continue

        row_count = 0
        match_ids: set[str] = set()
        for example in examples_by_split.get(split, []):
            row_count += 1
            match_id = example.get("matchId")
            decision_id = example.get("decisionId")
            if not isinstance(match_id, str) or not match_id:
                errors.append(f"MATCH_ID_REQUIRED:{split}")
                continue
            if not isinstance(decision_id, str) or not decision_id:
                errors.append(f"DECISION_ID_REQUIRED:{split}:{match_id}")
            else:
                previous_decision_split = decision_owner.setdefault(decision_id, split)
                if previous_decision_split != split:
                    errors.append(f"DECISION_CROSSES_SPLITS:{decision_id}:{previous_decision_split}->{split}")

            previous_match_split = match_owner.setdefault(match_id, split)
            if previous_match_split != split:
                errors.append(f"MATCH_CROSSES_SPLITS:{match_id}:{previous_match_split}->{split}")
            match_ids.add(match_id)

            state = example.get("state")
            decision_at_ms = finite_number(state.get("decisionAtMs")) if isinstance(state, dict) else None
            if decision_at_ms is None or decision_at_ms < from_ms or decision_at_ms >= to_ms:
                errors.append(f"DECISION_OUTSIDE_SPLIT_WINDOW:{split}:{decision_id or '<missing>'}")

        expected_decisions = descriptor.get("decisionCount")
        expected_matches = descriptor.get("matchCount")
        if not isinstance(expected_decisions, int) or expected_decisions != row_count:
            errors.append(f"SPLIT_DECISION_COUNT_MISMATCH:{split}:expected={expected_decisions}:actual={row_count}")
        if not isinstance(expected_matches, int) or expected_matches != len(match_ids):
            errors.append(f"SPLIT_MATCH_COUNT_MISMATCH:{split}:expected={expected_matches}:actual={len(match_ids)}")
        expected_match_sha = descriptor.get("matchSetSha256")
        actual_match_sha = hash_strings(sorted(match_ids))
        if expected_match_sha != actual_match_sha:
            errors.append(f"SPLIT_MATCH_SET_SHA256_MISMATCH:{split}")

    return sorted(set(errors))


def hash_strings(values: Iterable[str]) -> str:
    return hashlib.sha256("\n".join(values).encode("utf-8")).hexdigest()

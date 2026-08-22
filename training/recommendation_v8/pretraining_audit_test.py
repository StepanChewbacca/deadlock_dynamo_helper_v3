from __future__ import annotations

from pretraining_audit import audit_development_split_isolation, hash_strings
from common import parse_iso


def descriptor(split: str, start: str, end: str, matches: list[str], decisions: int):
    return {
        "split": split,
        "from": start,
        "to": end,
        "matchCount": len(set(matches)),
        "decisionCount": decisions,
        "matchSetSha256": hash_strings(sorted(set(matches))),
        "sealed": False,
    }


def example(split: str, match_id: str, decision_id: str, timestamp: str):
    return {
        "split": split,
        "matchId": match_id,
        "decisionId": decision_id,
        "state": {"decisionAtMs": parse_iso(timestamp) * 1000.0},
    }


def main() -> int:
    train = [example("TRAIN", "m-train", "d-train", "2026-07-02T00:00:00Z")]
    validation = [example("VALIDATION", "m-validation", "d-validation", "2026-07-12T00:00:00Z")]
    shadow = [example("SHADOW_HOLDOUT", "m-shadow", "d-shadow", "2026-07-17T00:00:00Z")]
    manifest = {
        "splits": [
            descriptor("TRAIN", "2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z", ["m-train"], 1),
            descriptor("VALIDATION", "2026-07-10T00:00:00Z", "2026-07-15T00:00:00Z", ["m-validation"], 1),
            descriptor("SHADOW_HOLDOUT", "2026-07-15T00:00:00Z", "2026-07-20T00:00:00Z", ["m-shadow"], 1),
        ],
    }
    valid = audit_development_split_isolation(manifest, {
        "TRAIN": train,
        "VALIDATION": validation,
        "SHADOW_HOLDOUT": shadow,
    })
    if valid:
        raise AssertionError(f"expected valid split isolation, got {valid}")

    crossing = audit_development_split_isolation(manifest, {
        "TRAIN": train,
        "VALIDATION": validation + [example("VALIDATION", "m-train", "d-cross", "2026-07-12T12:00:00Z")],
        "SHADOW_HOLDOUT": shadow,
    })
    if not any(error.startswith("MATCH_CROSSES_SPLITS:m-train") for error in crossing):
        raise AssertionError(f"expected cross-split match blocker, got {crossing}")

    outside = audit_development_split_isolation(manifest, {
        "TRAIN": [example("TRAIN", "m-train", "d-train", "2026-07-12T00:00:00Z")],
        "VALIDATION": validation,
        "SHADOW_HOLDOUT": shadow,
    })
    if "DECISION_OUTSIDE_SPLIT_WINDOW:TRAIN:d-train" not in outside:
        raise AssertionError(f"expected chronological window blocker, got {outside}")

    wrong_hash_manifest = {
        "splits": [dict(entry) for entry in manifest["splits"]],
    }
    wrong_hash_manifest["splits"][2]["matchSetSha256"] = "0" * 64
    wrong_hash = audit_development_split_isolation(wrong_hash_manifest, {
        "TRAIN": train,
        "VALIDATION": validation,
        "SHADOW_HOLDOUT": shadow,
    })
    if "SPLIT_MATCH_SET_SHA256_MISMATCH:SHADOW_HOLDOUT" not in wrong_hash:
        raise AssertionError(f"expected match-set hash blocker, got {wrong_hash}")

    print("pretraining split isolation fixtures: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

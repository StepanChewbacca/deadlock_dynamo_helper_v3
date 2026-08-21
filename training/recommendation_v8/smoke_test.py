from __future__ import annotations

import gzip
import hashlib
import json
import tempfile
from pathlib import Path

from common import canonical_json, iter_examples, verify_dataset_manifest


def main() -> int:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        splits_dir = root / "splits"
        splits_dir.mkdir()
        example = {
            "contractVersion": "recommendation-behavioral-training-example-v1",
            "split": "TRAIN",
            "decisionId": "d1",
            "matchId": "m1",
            "candidateGeneratorVersion": "candidate-v8",
            "state": {
                "contractVersion": "recommendation-features-v8",
                "decisionId": "d1",
                "matchId": "m1",
                "playerKey": "p1",
                "decisionAtMs": 2000,
                "stateSourceAtMs": 1900,
                "gameTimeSec": 100,
                "heroId": 1,
                "shopOpportunity": "AVAILABLE",
                "inventorySnapshotSha256": "a" * 64,
                "inventory": [],
                "history": [],
                "rulesetVersion": "r1",
                "catalogSha256": "b" * 64,
            },
            "candidates": [
                {"actionKey": "WAIT_SAVE", "actionType": "WAIT_SAVE", "effectiveCostSouls": 0, "feasible": True},
            ],
            "observedActionKey": "WAIT_SAVE",
            "observedActionInjected": False,
            "actionLoggingPropensity": 1,
            "actionLoggingPropensitySource": "RECORDED_AT_ACTION_SELECTION",
        }
        files = []
        split_ranges = [
            ("TRAIN", "2026-07-01T00:00:00.000Z", "2026-07-02T00:00:00.000Z"),
            ("VALIDATION", "2026-07-02T00:00:00.000Z", "2026-07-03T00:00:00.000Z"),
            ("SHADOW_HOLDOUT", "2026-07-03T00:00:00.000Z", "2026-07-04T00:00:00.000Z"),
            ("FUTURE_TEST", "2026-07-04T00:00:00.000Z", "2026-07-05T00:00:00.000Z"),
        ]
        split_descriptors = []
        for split, start, end in split_ranges:
            if split == "FUTURE_TEST":
                split_descriptors.append({
                    "split": split,
                    "from": start,
                    "to": end,
                    "matchCount": 0,
                    "decisionCount": 0,
                    "matchSetSha256": hashlib.sha256(b"").hexdigest(),
                    "sealed": True,
                })
                continue
            relative = f"splits/{split.lower()}.jsonl.gz"
            path = root / relative
            row = dict(example)
            row["split"] = split
            with gzip.open(path, "wt", encoding="utf-8") as handle:
                handle.write(json.dumps(row) + "\n")
            raw = path.read_bytes()
            files.append({"path": relative, "sha256": hashlib.sha256(raw).hexdigest(), "sizeBytes": len(raw), "rowCount": 1})
            split_descriptors.append({
                "split": split,
                "from": start,
                "to": end,
                "matchCount": 1,
                "decisionCount": 1,
                "matchSetSha256": hashlib.sha256(b"m1").hexdigest(),
                "sealed": False,
            })

        base = {
            "contractVersion": "recommendation-dataset-manifest-v1",
            "datasetId": "dataset-smoke",
            "createdAt": "2026-08-21T00:00:00.000Z",
            "sourceCommitSha": "c" * 40,
            "datasetContractVersion": "recommendation-dataset-v8",
            "featureContractVersion": "recommendation-features-v8",
            "actionContractVersion": "recommendation-actions-v1",
            "candidateGeneratorVersion": "candidate-v8",
            "pointInTimeCorrect": True,
            "observedActionInjected": False,
            "futureTestTouched": False,
            "supportedRulesetVersions": ["r1"],
            "supportedCatalogSha256": ["b" * 64],
            "splits": split_descriptors,
            "files": files,
        }
        manifest = dict(base)
        manifest["datasetSha256"] = hashlib.sha256(canonical_json(base).encode("utf-8")).hexdigest()
        (root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        verified = verify_dataset_manifest(root)
        assert len(list(iter_examples(root, verified, "TRAIN"))) == 1
        assert not (root / "splits" / "future_test.jsonl.gz").exists()
        try:
            list(iter_examples(root, verified, "FUTURE_TEST"))
        except ValueError as error:
            assert "FUTURE_TEST_ACCESS_FORBIDDEN" in str(error)
        else:
            raise AssertionError("FUTURE_TEST access must be blocked")
    print("recommendation v8 training smoke test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
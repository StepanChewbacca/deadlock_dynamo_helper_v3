from __future__ import annotations

import gzip
import json
import stat
import tempfile
import unittest
from pathlib import Path

from common import canonical_json, sha256_bytes, sha256_file
from dataset_snapshot import snapshot_dataset
from pretraining_audit import hash_strings


CATALOG_SHA256 = "a" * 64
DIRECT_SHOP_SUBJECT_SHA256 = "b" * 64


class DatasetSnapshotTest(unittest.TestCase):
    def test_snapshots_exact_verified_dataset_and_seals_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            dataset_sha256, manifest_sha256 = write_dataset(source)
            destination = root / "snapshot"

            report = snapshot_dataset(source, destination, dataset_sha256, manifest_sha256)

            self.assertEqual("recommendation-training-dataset-snapshot-v1", report["contractVersion"])
            self.assertEqual(dataset_sha256, report["datasetSha256"])
            self.assertEqual(manifest_sha256, report["manifestSha256"])
            self.assertTrue(report["readOnly"])
            self.assertFalse(report["futureTestPayloadDecoded"])
            self.assertTrue((destination / "manifest.json").is_file())
            self.assertFalse((destination / "unlisted.txt").exists())
            self.assertEqual(0, stat.S_IMODE(destination.stat().st_mode) & stat.S_IWUSR)
            self.assertEqual(0, stat.S_IMODE((destination / "manifest.json").stat().st_mode) & stat.S_IWUSR)

    def test_rejects_dataset_identity_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            _, manifest_sha256 = write_dataset(source)

            with self.assertRaisesRegex(ValueError, "dataset"):
                snapshot_dataset(source, root / "snapshot", "c" * 64, manifest_sha256)

            self.assertFalse((root / "snapshot").exists())

    def test_rejects_symlinked_manifest_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            dataset_sha256, manifest_sha256 = write_dataset(source)
            train = source / "splits" / "train.jsonl.gz"
            external = root / "external.jsonl.gz"
            external.write_bytes(train.read_bytes())
            train.unlink()
            train.symlink_to(external)

            with self.assertRaisesRegex(ValueError, "symlink"):
                snapshot_dataset(source, root / "snapshot", dataset_sha256, manifest_sha256)

            self.assertFalse((root / "snapshot").exists())


def write_dataset(root: Path) -> tuple[str, str]:
    splits_dir = root / "splits"
    splits_dir.mkdir()
    windows = {
        "TRAIN": ("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", 1767268800000),
        "VALIDATION": ("2026-01-02T00:00:00Z", "2026-01-03T00:00:00Z", 1767355200000),
        "SHADOW_HOLDOUT": ("2026-01-03T00:00:00Z", "2026-01-04T00:00:00Z", 1767441600000),
    }
    files = []
    split_descriptors = []
    for index, (split, (from_value, to_value, decision_at_ms)) in enumerate(windows.items(), start=1):
        match_id = f"match-{index}"
        decision_id = f"decision-{index}"
        example = {
            "contractVersion": "recommendation-behavioral-training-example-v1",
            "split": split,
            "decisionId": decision_id,
            "matchId": match_id,
            "candidateGeneratorVersion": "candidate-v1",
            "observedActionInjected": False,
            "observedActionKey": "WAIT_SAVE",
            "state": {
                "contractVersion": "recommendation-features-v8",
                "decisionId": decision_id,
                "matchId": match_id,
                "decisionAtMs": decision_at_ms,
                "stateSourceAtMs": decision_at_ms - 1000,
                "history": [],
                "rulesetVersion": "ruleset-v1",
                "catalogSha256": CATALOG_SHA256,
            },
            "candidates": [
                {
                    "actionKey": "WAIT_SAVE",
                    "actionType": "WAIT_SAVE",
                    "effectiveCostSouls": 0,
                    "feasible": True,
                }
            ],
        }
        relative = f"splits/{split.lower()}.jsonl.gz"
        path = root / relative
        with gzip.open(path, "wt", encoding="utf-8") as handle:
            handle.write(json.dumps(example, separators=(",", ":")) + "\n")
        files.append(
            {
                "path": relative,
                "sha256": sha256_file(path),
                "sizeBytes": path.stat().st_size,
                "rowCount": 1,
            }
        )
        split_descriptors.append(
            {
                "split": split,
                "from": from_value,
                "to": to_value,
                "matchCount": 1,
                "decisionCount": 1,
                "matchSetSha256": hash_strings([match_id]),
                "sealed": False,
            }
        )

    split_descriptors.append(
        {
            "split": "FUTURE_TEST",
            "from": "2026-01-04T00:00:00Z",
            "to": "2026-01-05T00:00:00Z",
            "matchCount": 0,
            "decisionCount": 0,
            "matchSetSha256": hash_strings([]),
            "sealed": True,
        }
    )
    manifest_base = {
        "contractVersion": "recommendation-dataset-manifest-v1",
        "datasetId": "dataset-snapshot-test",
        "createdAt": "2026-01-05T00:00:00Z",
        "sourceCommitSha": "d" * 40,
        "datasetContractVersion": "recommendation-dataset-v8",
        "featureContractVersion": "recommendation-features-v8",
        "actionContractVersion": "recommendation-actions-v1",
        "candidateGeneratorVersion": "candidate-v1",
        "directShopSourceApprovalKeys": ["gep:shop_available"],
        "directShopSourceValidationSubjectSha256": DIRECT_SHOP_SUBJECT_SHA256,
        "pointInTimeCorrect": True,
        "observedActionInjected": False,
        "futureTestTouched": False,
        "supportedRulesetVersions": ["ruleset-v1"],
        "supportedCatalogSha256": [CATALOG_SHA256],
        "splits": split_descriptors,
        "files": files,
    }
    dataset_sha256 = sha256_bytes(canonical_json(manifest_base).encode("utf-8"))
    manifest = {**manifest_base, "datasetSha256": dataset_sha256}
    manifest_sha256 = sha256_bytes(canonical_json(manifest).encode("utf-8"))
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (root / "unlisted.txt").write_text("must not be copied\n", encoding="utf-8")
    return dataset_sha256, manifest_sha256


if __name__ == "__main__":
    unittest.main()

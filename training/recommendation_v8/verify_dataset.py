from __future__ import annotations

import argparse
import json
from pathlib import Path

from common import dataset_identity, verify_dataset_manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify an immutable Recommendation Dataset V8 before training")
    parser.add_argument("--dataset-dir", required=True)
    parser.add_argument("--expected-dataset-sha256")
    parser.add_argument("--expected-manifest-sha256")
    args = parser.parse_args()
    manifest = verify_dataset_manifest(
        Path(args.dataset_dir).resolve(),
        expected_dataset_sha256=args.expected_dataset_sha256 or None,
        expected_manifest_sha256=args.expected_manifest_sha256 or None,
    )
    identity = dataset_identity(manifest)
    print(json.dumps({
        "status": "PASS",
        "datasetId": identity.dataset_id,
        "datasetSha256": identity.dataset_sha256,
        "manifestSha256": identity.manifest_sha256,
        "featureContractVersion": identity.feature_contract_version,
        "candidateGeneratorVersion": identity.candidate_generator_version,
        "futureTestPayloadDecoded": False,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

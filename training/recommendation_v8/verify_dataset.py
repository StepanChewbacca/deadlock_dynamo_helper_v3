from __future__ import annotations

import argparse
import json
from pathlib import Path

from common import dataset_identity, verify_dataset_manifest
from dataset_trust_contract import assert_dataset_direct_shop_trust
from pretraining_audit import verify_development_split_isolation


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify an immutable Recommendation Dataset V8 before training")
    parser.add_argument("--dataset-dir", required=True)
    parser.add_argument("--expected-dataset-sha256")
    parser.add_argument("--expected-manifest-sha256")
    args = parser.parse_args()
    dataset_dir = Path(args.dataset_dir).resolve()
    manifest = verify_dataset_manifest(
        dataset_dir,
        expected_dataset_sha256=args.expected_dataset_sha256 or None,
        expected_manifest_sha256=args.expected_manifest_sha256 or None,
    )
    assert_dataset_direct_shop_trust(manifest)
    verify_development_split_isolation(dataset_dir, manifest)
    identity = dataset_identity(manifest)
    print(json.dumps({
        "status": "PASS",
        "datasetId": identity.dataset_id,
        "datasetSha256": identity.dataset_sha256,
        "manifestSha256": identity.manifest_sha256,
        "featureContractVersion": identity.feature_contract_version,
        "candidateGeneratorVersion": identity.candidate_generator_version,
        "directShopSourceApprovalKeys": manifest["directShopSourceApprovalKeys"],
        "directShopSourceValidationSubjectSha256": manifest["directShopSourceValidationSubjectSha256"],
        "developmentSplitIsolationVerified": True,
        "futureTestPayloadDecoded": False,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

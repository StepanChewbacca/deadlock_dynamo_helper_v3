from __future__ import annotations

from dataset_trust_contract import validate_dataset_direct_shop_trust


APPROVAL_KEY = "OVERWOLF_GEP:onInfoUpdates2|match_info|match_info|shop_state"
SUBJECT_SHA = "a" * 64


def manifest(**overrides):
    value = {
        "directShopSourceApprovalKeys": [APPROVAL_KEY],
        "directShopSourceValidationSubjectSha256": SUBJECT_SHA,
    }
    value.update(overrides)
    return value


def main() -> int:
    assert validate_dataset_direct_shop_trust(manifest()) == []

    missing = validate_dataset_direct_shop_trust({})
    assert "DIRECT_SHOP_SOURCE_APPROVAL_KEYS_REQUIRED" in missing
    assert "DIRECT_SHOP_SOURCE_APPROVAL_SET_MUST_CONTAIN_EXACTLY_ONE_KEY" in missing
    assert "DIRECT_SHOP_SOURCE_VALIDATION_SUBJECT_SHA256_INVALID" in missing

    duplicated = validate_dataset_direct_shop_trust(manifest(
        directShopSourceApprovalKeys=[APPROVAL_KEY, APPROVAL_KEY],
    ))
    assert "DIRECT_SHOP_SOURCE_APPROVAL_KEYS_NOT_CANONICAL" in duplicated

    multiple = validate_dataset_direct_shop_trust(manifest(
        directShopSourceApprovalKeys=[APPROVAL_KEY, "OTHER:field"],
    ))
    assert "DIRECT_SHOP_SOURCE_APPROVAL_SET_MUST_CONTAIN_EXACTLY_ONE_KEY" in multiple

    malformed = validate_dataset_direct_shop_trust(manifest(
        directShopSourceApprovalKeys=["missing-separator"],
    ))
    assert "DIRECT_SHOP_SOURCE_APPROVAL_KEY_INVALID" in malformed

    invalid_subject = validate_dataset_direct_shop_trust(manifest(
        directShopSourceValidationSubjectSha256="not-a-sha",
    ))
    assert "DIRECT_SHOP_SOURCE_VALIDATION_SUBJECT_SHA256_INVALID" in invalid_subject

    print("recommendation dataset direct-shop trust fixtures: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

from typing import Any, Mapping


def validate_dataset_direct_shop_trust(manifest: Mapping[str, Any]) -> list[str]:
    errors: list[str] = []
    approval_keys = manifest.get("directShopSourceApprovalKeys")
    if not isinstance(approval_keys, list) or not approval_keys:
        errors.append("DIRECT_SHOP_SOURCE_APPROVAL_KEYS_REQUIRED")
        approval_keys = []

    normalized: list[str] = []
    for value in approval_keys:
        if not isinstance(value, str):
            errors.append("DIRECT_SHOP_SOURCE_APPROVAL_KEY_INVALID")
            continue
        key = value.strip()
        separator = key.find(":")
        if separator <= 0 or separator == len(key) - 1:
            errors.append("DIRECT_SHOP_SOURCE_APPROVAL_KEY_INVALID")
        normalized.append(key)

    canonical = sorted(set(normalized))
    if approval_keys != canonical:
        errors.append("DIRECT_SHOP_SOURCE_APPROVAL_KEYS_NOT_CANONICAL")
    if len(canonical) != 1:
        errors.append("DIRECT_SHOP_SOURCE_APPROVAL_SET_MUST_CONTAIN_EXACTLY_ONE_KEY")

    subject_sha = manifest.get("directShopSourceValidationSubjectSha256")
    if not is_sha256(subject_sha):
        errors.append("DIRECT_SHOP_SOURCE_VALIDATION_SUBJECT_SHA256_INVALID")

    return sorted(set(errors))


def assert_dataset_direct_shop_trust(manifest: Mapping[str, Any]) -> None:
    errors = validate_dataset_direct_shop_trust(manifest)
    if errors:
        raise ValueError("Invalid Dataset V8 direct-shop trust binding: " + ",".join(errors))


def is_sha256(value: Any) -> bool:
    if not isinstance(value, str) or len(value) != 64:
        return False
    return all(character in "0123456789abcdefABCDEF" for character in value)

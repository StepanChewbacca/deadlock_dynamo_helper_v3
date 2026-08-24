from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List

CONTRACT_VERSION = "recommendation-training-wheelhouse-identity-v1"
CHUNK_SIZE = 1024 * 1024


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compute and verify an immutable training wheelhouse identity")
    parser.add_argument("--wheelhouse", required=True)
    parser.add_argument("--expected-sha256")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    wheelhouse = Path(args.wheelhouse).resolve(strict=True)
    report = wheelhouse_identity(wheelhouse)
    expected = args.expected_sha256.lower() if args.expected_sha256 else None
    if expected is not None:
        if not is_sha256(expected):
            raise ValueError("expected wheelhouse SHA256 is invalid")
        if report["wheelhouseSha256"] != expected:
            raise ValueError(
                f"training wheelhouse identity mismatch: expected={expected}:actual={report['wheelhouseSha256']}"
            )
    print(json.dumps(report, separators=(",", ":"), sort_keys=True))
    return 0


def wheelhouse_identity(root: Path) -> Dict[str, Any]:
    if not root.is_dir():
        raise ValueError("training wheelhouse must be a directory")
    descriptors: List[Dict[str, Any]] = []
    for path in sorted(root.rglob("*"), key=lambda value: value.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            raise ValueError(f"training wheelhouse symlink is forbidden: {relative}")
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError(f"training wheelhouse contains a non-regular file: {relative}")
        descriptors.append(
            {
                "path": relative,
                "sha256": sha256_file(path),
                "sizeBytes": path.stat().st_size,
            }
        )
    if not descriptors:
        raise ValueError("training wheelhouse is empty")
    identity = {
        "contractVersion": CONTRACT_VERSION,
        "files": descriptors,
    }
    return {
        **identity,
        "fileCount": len(descriptors),
        "wheelhouseSha256": hashlib.sha256(canonical_json(identity).encode("utf-8")).hexdigest(),
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


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


def is_sha256(value: str) -> bool:
    return len(value) == 64 and all(character in "0123456789abcdef" for character in value.lower())


if __name__ == "__main__":
    raise SystemExit(main())

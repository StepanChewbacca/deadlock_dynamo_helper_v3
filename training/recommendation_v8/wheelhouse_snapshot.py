from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path
from typing import Any, Dict

from wheelhouse_identity import is_sha256, wheelhouse_identity

CONTRACT_VERSION = "recommendation-training-wheelhouse-snapshot-v1"
COPY_CHUNK_SIZE = 1024 * 1024


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Copy an approved training wheelhouse into a private immutable run snapshot"
    )
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--expected-sha256", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = snapshot_wheelhouse(
        Path(args.source),
        Path(args.destination),
        args.expected_sha256,
    )
    print(json.dumps(report, separators=(",", ":"), sort_keys=True))
    return 0


def snapshot_wheelhouse(source: Path, destination: Path, expected_sha256: str) -> Dict[str, Any]:
    expected = expected_sha256.lower()
    if not is_sha256(expected):
        raise ValueError("expected wheelhouse SHA256 is invalid")

    source = source.resolve(strict=True)
    if not source.is_dir():
        raise ValueError("training wheelhouse source must be a directory")

    source_identity = wheelhouse_identity(source)
    if source_identity["wheelhouseSha256"] != expected:
        raise ValueError(
            "training wheelhouse source identity mismatch: "
            f"expected={expected}:actual={source_identity['wheelhouseSha256']}"
        )

    destination = destination.absolute()
    if destination.exists() or destination.is_symlink():
        raise ValueError("training wheelhouse snapshot destination must not exist")
    parent = destination.parent.resolve(strict=True)
    if not parent.is_dir():
        raise ValueError("training wheelhouse snapshot parent must be a directory")
    destination = parent / destination.name

    destination.mkdir(mode=0o700)
    try:
        for descriptor in source_identity["files"]:
            relative = Path(descriptor["path"])
            source_file = source / relative
            target_file = destination / relative
            if source_file.is_symlink() or not source_file.is_file():
                raise ValueError(f"training wheelhouse source changed during snapshot: {descriptor['path']}")
            target_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with source_file.open("rb") as source_handle, target_file.open("xb") as target_handle:
                shutil.copyfileobj(source_handle, target_handle, length=COPY_CHUNK_SIZE)
                target_handle.flush()
                os.fsync(target_handle.fileno())

        snapshot_identity = wheelhouse_identity(destination)
        if snapshot_identity["wheelhouseSha256"] != expected:
            raise ValueError(
                "training wheelhouse snapshot identity mismatch: "
                f"expected={expected}:actual={snapshot_identity['wheelhouseSha256']}"
            )
        if snapshot_identity["files"] != source_identity["files"]:
            raise ValueError("training wheelhouse snapshot file descriptors differ from approved source identity")

        make_read_only(destination)
        read_only_identity = wheelhouse_identity(destination)
        if read_only_identity["wheelhouseSha256"] != expected:
            raise ValueError("training wheelhouse snapshot identity changed while sealing read-only")

        return {
            "contractVersion": CONTRACT_VERSION,
            "wheelhouseSha256": expected,
            "fileCount": snapshot_identity["fileCount"],
            "source": str(source),
            "snapshot": str(destination),
            "readOnly": True,
        }
    except Exception:
        make_writable(destination)
        shutil.rmtree(destination, ignore_errors=True)
        raise


def make_read_only(root: Path) -> None:
    for path in sorted(root.rglob("*"), key=lambda value: len(value.parts), reverse=True):
        if path.is_symlink():
            raise ValueError(f"training wheelhouse snapshot symlink is forbidden: {path.relative_to(root)}")
        if path.is_file():
            path.chmod(0o444)
        elif path.is_dir():
            path.chmod(0o555)
        else:
            raise ValueError(f"training wheelhouse snapshot contains a non-regular entry: {path.relative_to(root)}")
    root.chmod(0o555)


def make_writable(root: Path) -> None:
    if not root.exists() or root.is_symlink():
        return
    try:
        root.chmod(0o700)
    except OSError:
        return
    for path in root.rglob("*"):
        if path.is_symlink():
            continue
        try:
            path.chmod(0o700 if path.is_dir() else 0o600)
        except OSError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())

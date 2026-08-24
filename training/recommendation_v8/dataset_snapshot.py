from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path
from typing import Any, Dict, Iterable

from common import dataset_identity, is_sha256, verify_dataset_manifest
from dataset_trust_contract import assert_dataset_direct_shop_trust
from pretraining_audit import verify_development_split_isolation

CONTRACT_VERSION = "recommendation-training-dataset-snapshot-v1"
COPY_CHUNK_SIZE = 1024 * 1024


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Copy a verified Recommendation Dataset V8 into a private immutable run snapshot"
    )
    parser.add_argument("--source", required=True)
    parser.add_argument("--destination", required=True)
    parser.add_argument("--expected-dataset-sha256", required=True)
    parser.add_argument("--expected-manifest-sha256", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    report = snapshot_dataset(
        Path(args.source),
        Path(args.destination),
        args.expected_dataset_sha256,
        args.expected_manifest_sha256,
    )
    print(json.dumps(report, separators=(",", ":"), sort_keys=True))
    return 0


def snapshot_dataset(
    source: Path,
    destination: Path,
    expected_dataset_sha256: str,
    expected_manifest_sha256: str,
) -> Dict[str, Any]:
    expected_dataset = expected_dataset_sha256.lower()
    expected_manifest = expected_manifest_sha256.lower()
    if not is_sha256(expected_dataset):
        raise ValueError("expected dataset SHA256 is invalid")
    if not is_sha256(expected_manifest):
        raise ValueError("expected manifest SHA256 is invalid")

    source = source.resolve(strict=True)
    if not source.is_dir():
        raise ValueError("training dataset source must be a directory")
    manifest_path = source / "manifest.json"
    assert_regular_source_path(source, manifest_path, "manifest.json")

    source_manifest = verify_dataset_manifest(
        source,
        expected_dataset_sha256=expected_dataset,
        expected_manifest_sha256=expected_manifest,
    )
    assert_dataset_direct_shop_trust(source_manifest)
    verify_development_split_isolation(source, source_manifest)

    relative_files = manifest_relative_files(source_manifest)
    for relative in relative_files:
        assert_regular_source_path(source, source / relative, relative.as_posix())

    destination = destination.absolute()
    if destination.exists() or destination.is_symlink():
        raise ValueError("training dataset snapshot destination must not exist")
    parent = destination.parent.resolve(strict=True)
    if not parent.is_dir():
        raise ValueError("training dataset snapshot parent must be a directory")
    destination = parent / destination.name

    destination.mkdir(mode=0o700)
    try:
        copy_regular_file(manifest_path, destination / "manifest.json")
        for relative in relative_files:
            source_file = source / relative
            assert_regular_source_path(source, source_file, relative.as_posix())
            target_file = destination / relative
            target_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            copy_regular_file(source_file, target_file)

        snapshot_manifest = verify_dataset_manifest(
            destination,
            expected_dataset_sha256=expected_dataset,
            expected_manifest_sha256=expected_manifest,
        )
        assert_dataset_direct_shop_trust(snapshot_manifest)
        verify_development_split_isolation(destination, snapshot_manifest)
        identity = dataset_identity(snapshot_manifest)
        if identity.dataset_sha256.lower() != expected_dataset:
            raise ValueError("training dataset snapshot dataset identity mismatch")
        if identity.manifest_sha256.lower() != expected_manifest:
            raise ValueError("training dataset snapshot manifest identity mismatch")

        make_read_only(destination)
        sealed_manifest = verify_dataset_manifest(
            destination,
            expected_dataset_sha256=expected_dataset,
            expected_manifest_sha256=expected_manifest,
        )
        assert_dataset_direct_shop_trust(sealed_manifest)
        verify_development_split_isolation(destination, sealed_manifest)

        return {
            "contractVersion": CONTRACT_VERSION,
            "datasetId": identity.dataset_id,
            "datasetSha256": expected_dataset,
            "manifestSha256": expected_manifest,
            "sourceCommitSha": sealed_manifest.get("sourceCommitSha"),
            "fileCount": len(relative_files),
            "source": str(source),
            "snapshot": str(destination),
            "readOnly": True,
            "futureTestPayloadDecoded": False,
        }
    except Exception:
        make_writable(destination)
        shutil.rmtree(destination, ignore_errors=True)
        raise


def manifest_relative_files(manifest: Dict[str, Any]) -> list[Path]:
    result: list[Path] = []
    for descriptor in manifest.get("files", []):
        if not isinstance(descriptor, dict):
            raise ValueError("training dataset manifest contains an invalid file descriptor")
        raw = descriptor.get("path")
        if not isinstance(raw, str) or not raw:
            raise ValueError("training dataset manifest contains an invalid file path")
        relative = Path(raw)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"training dataset manifest path is unsafe: {raw}")
        result.append(relative)
    if not result:
        raise ValueError("training dataset manifest contains no artifact files")
    return result


def assert_regular_source_path(root: Path, path: Path, label: str) -> None:
    relative = path.relative_to(root)
    current = root
    for part in relative.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"training dataset source symlink is forbidden: {label}")
    resolved = path.resolve(strict=True)
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise ValueError(f"training dataset source escapes root: {label}") from error
    if not path.is_file():
        raise ValueError(f"training dataset source is not a regular file: {label}")


def copy_regular_file(source: Path, destination: Path) -> None:
    if source.is_symlink() or not source.is_file():
        raise ValueError(f"training dataset source changed during snapshot: {source}")
    with source.open("rb") as source_handle, destination.open("xb") as target_handle:
        shutil.copyfileobj(source_handle, target_handle, length=COPY_CHUNK_SIZE)
        target_handle.flush()
        os.fsync(target_handle.fileno())


def make_read_only(root: Path) -> None:
    for path in sorted(root.rglob("*"), key=lambda value: len(value.parts), reverse=True):
        if path.is_symlink():
            raise ValueError(f"training dataset snapshot symlink is forbidden: {path.relative_to(root)}")
        if path.is_file():
            path.chmod(0o444)
        elif path.is_dir():
            path.chmod(0o555)
        else:
            raise ValueError(f"training dataset snapshot contains a non-regular entry: {path.relative_to(root)}")
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

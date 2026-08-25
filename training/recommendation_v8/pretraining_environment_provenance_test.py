from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from pretraining_environment_check import inspect_wheelhouse_packages, wheel_distribution_identity


class PretrainingEnvironmentProvenanceTest(unittest.TestCase):
    def test_reads_distribution_identity_from_wheel_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            wheel = Path(temporary) / "demo_pkg-1.2.3-py3-none-any.whl"
            write_wheel(wheel, "Demo_Pkg", "1.2.3")
            self.assertEqual(("demo-pkg", "1.2.3"), wheel_distribution_identity(wheel))

    def test_rejects_multiple_versions_for_same_distribution(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_wheel(root / "demo_pkg-1.0.0-py3-none-any.whl", "demo-pkg", "1.0.0")
            write_wheel(root / "demo_pkg-2.0.0-py3-none-any.whl", "demo_pkg", "2.0.0")
            versions, blockers = inspect_wheelhouse_packages(root)
            self.assertEqual({"1.0.0", "2.0.0"}, versions["demo-pkg"])
            self.assertTrue(any(value.startswith("APPROVED_WHEELHOUSE_VERSION_AMBIGUOUS:demo-pkg") for value in blockers))

    def test_rejects_source_distribution_archives(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write_wheel(root / "demo_pkg-1.0.0-py3-none-any.whl", "demo-pkg", "1.0.0")
            (root / "dependency-1.0.0.tar.gz").write_bytes(b"source archive")
            _, blockers = inspect_wheelhouse_packages(root)
            self.assertIn(
                "TRAINING_WHEELHOUSE_SOURCE_ARCHIVE_FORBIDDEN:dependency-1.0.0.tar.gz",
                blockers,
            )


def write_wheel(path: Path, name: str, version: str) -> None:
    dist_info = f"{name.replace('-', '_')}-{version}.dist-info"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            f"{dist_info}/METADATA",
            f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n\n",
        )
        archive.writestr(f"{dist_info}/WHEEL", "Wheel-Version: 1.0\nTag: py3-none-any\n")


if __name__ == "__main__":
    unittest.main()

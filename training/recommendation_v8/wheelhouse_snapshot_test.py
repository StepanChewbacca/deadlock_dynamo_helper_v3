from __future__ import annotations

import stat
import tempfile
import unittest
from pathlib import Path

from wheelhouse_identity import wheelhouse_identity
from wheelhouse_snapshot import snapshot_wheelhouse


class WheelhouseSnapshotTest(unittest.TestCase):
    def test_snapshots_exact_bytes_and_seals_read_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (source / "torch.whl").write_bytes(b"torch-wheel")
            nested = source / "deps"
            nested.mkdir()
            (nested / "dependency.whl").write_bytes(b"dependency-wheel")
            expected = wheelhouse_identity(source)["wheelhouseSha256"]
            destination = root / "snapshot"

            report = snapshot_wheelhouse(source, destination, expected)

            self.assertEqual(expected, report["wheelhouseSha256"])
            self.assertTrue(report["readOnly"])
            self.assertEqual(expected, wheelhouse_identity(destination)["wheelhouseSha256"])
            self.assertFalse(destination.stat().st_mode & stat.S_IWUSR)
            self.assertFalse((destination / "torch.whl").stat().st_mode & stat.S_IWUSR)

    def test_rejects_source_identity_mismatch_without_leaving_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            wheel = source / "torch.whl"
            wheel.write_bytes(b"approved")
            expected = wheelhouse_identity(source)["wheelhouseSha256"]
            wheel.write_bytes(b"changed")
            destination = root / "snapshot"

            with self.assertRaisesRegex(ValueError, "source identity mismatch"):
                snapshot_wheelhouse(source, destination, expected)

            self.assertFalse(destination.exists())

    def test_rejects_existing_destination(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            (source / "torch.whl").write_bytes(b"approved")
            expected = wheelhouse_identity(source)["wheelhouseSha256"]
            destination = root / "snapshot"
            destination.mkdir()

            with self.assertRaisesRegex(ValueError, "destination must not exist"):
                snapshot_wheelhouse(source, destination, expected)

    def test_rejects_symlinked_source_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            source.mkdir()
            target = root / "target.whl"
            target.write_bytes(b"target")
            try:
                (source / "linked.whl").symlink_to(target)
            except (OSError, NotImplementedError):
                self.skipTest("symlink creation is unavailable")

            with self.assertRaisesRegex(ValueError, "symlink is forbidden"):
                wheelhouse_identity(source)


if __name__ == "__main__":
    unittest.main()

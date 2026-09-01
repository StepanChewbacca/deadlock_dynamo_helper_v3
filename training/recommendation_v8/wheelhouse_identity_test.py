from __future__ import annotations

import tempfile
from pathlib import Path

from wheelhouse_identity import wheelhouse_identity


def main() -> int:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        (root / "torch-2.6.0.whl").write_bytes(b"torch-wheel")
        nested = root / "cuda"
        nested.mkdir()
        (nested / "dependency.whl").write_bytes(b"cuda-dependency")

        first = wheelhouse_identity(root)
        second = wheelhouse_identity(root)
        assert first["wheelhouseSha256"] == second["wheelhouseSha256"]
        assert first["fileCount"] == 2
        assert [item["path"] for item in first["files"]] == ["cuda/dependency.whl", "torch-2.6.0.whl"]

        (nested / "dependency.whl").write_bytes(b"changed")
        changed = wheelhouse_identity(root)
        assert changed["wheelhouseSha256"] != first["wheelhouseSha256"]

    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        target = root / "target.whl"
        target.write_bytes(b"target")
        link = root / "link.whl"
        try:
            link.symlink_to(target)
        except (OSError, NotImplementedError):
            pass
        else:
            try:
                wheelhouse_identity(root)
            except ValueError as error:
                assert "symlink is forbidden" in str(error)
            else:
                raise AssertionError("wheelhouse symlink must be rejected")

    print("training wheelhouse identity: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/python3
"""Stream a portable archive; a local vault key is included only inside encryption."""

from __future__ import annotations

import getpass
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import time


ROOT = Path(os.environ.get("SECOND_BRAIN_DATA_ROOT", Path.home() / "SecondBrainData")).expanduser().resolve()
ARCHIVE_ROOT = "SecondBrainData"
KEY_MEMBER = f"{ARCHIVE_ROOT}/.migration/private_vault_key"
KEYCHAIN_SERVICE = os.environ.get("PII_VAULT_KEYCHAIN_SERVICE", "com.vashisht.personal-ai.pii-vault")
EXCLUDED_PARTS = {"node_modules", "out", ".venv", "venv", "__pycache__"}


def include(info: tarfile.TarInfo):
    if info.name == KEY_MEMBER:
        return None
    parts = Path(info.name).parts
    if any(part in EXCLUDED_PARTS for part in parts):
        return None
    if "models" in parts and any(part in {"base", "downloads", "cache"} for part in parts):
        return None
    return info


def keychain_key():
    result = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-a", getpass.getuser(), "-s", KEYCHAIN_SERVICE, "-w"],
        capture_output=True,
    )
    return result.stdout.strip() if result.returncode == 0 else b""


def main():
    if not ROOT.is_dir():
        raise RuntimeError(f"Data root not found: {ROOT}")
    with tarfile.open(fileobj=sys.stdout.buffer, mode="w|gz") as archive:
        archive.add(ROOT, arcname=ARCHIVE_ROOT, recursive=True, filter=include)
        vault_key = keychain_key()
        if vault_key:
            member = tarfile.TarInfo(KEY_MEMBER)
            member.size = len(vault_key)
            member.mode = 0o600
            member.mtime = int(time.time())
            archive.addfile(member, io.BytesIO(vault_key))


if __name__ == "__main__":
    main()

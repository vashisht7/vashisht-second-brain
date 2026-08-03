#!/usr/bin/python3
"""Safely restore a migration stream and optionally import its vault key."""

from __future__ import annotations

import getpass
from pathlib import Path, PurePosixPath
import os
import subprocess
import sys
import tarfile


HOME = Path.home().resolve()
ARCHIVE_ROOT = "SecondBrainData"
KEY_MEMBER = f"{ARCHIVE_ROOT}/.migration/private_vault_key"
KEYCHAIN_SERVICE = os.environ.get("PII_VAULT_KEYCHAIN_SERVICE", "com.vashisht.personal-ai.pii-vault")


def safe_member(member):
    path = PurePosixPath(member.name)
    if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != ARCHIVE_ROOT:
        return False
    if member.issym() or member.islnk():
        link = PurePosixPath(member.linkname)
        if link.is_absolute() or ".." in link.parts:
            return False
    return True


def main():
    vault_key = None
    with tarfile.open(fileobj=sys.stdin.buffer, mode="r|gz") as archive:
        for member in archive:
            if not safe_member(member):
                raise RuntimeError(f"Unsafe archive entry: {member.name}")
            if member.name == KEY_MEMBER:
                handle = archive.extractfile(member)
                vault_key = handle.read().decode("ascii") if handle else None
                continue
            archive.extract(member, path=HOME)
    if vault_key:
        subprocess.run(
            ["/usr/bin/security", "add-generic-password", "-U", "-a", getpass.getuser(), "-s", KEYCHAIN_SERVICE, "-w", vault_key],
            check=True,
            capture_output=True,
        )


if __name__ == "__main__":
    main()

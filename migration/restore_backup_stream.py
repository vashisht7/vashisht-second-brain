#!/usr/bin/python3
"""Restore a migration archive safely and import its vault key without writing it."""

from __future__ import annotations

import getpass
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tarfile


HOME = Path.home().resolve()
KEY_MEMBER = ".vashisht-migration/private_vault_key"
SERVICE = "com.vashisht.personal-ai.pii-vault"


def safe_member(member: tarfile.TarInfo) -> bool:
    path = PurePosixPath(member.name)
    if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != "PersonalAIData":
        return False
    if member.issym() or member.islnk():
        link = PurePosixPath(member.linkname)
        if link.is_absolute() or ".." in link.parts:
            return False
    return True


def main() -> None:
    vault_key = None
    with tarfile.open(fileobj=sys.stdin.buffer, mode="r|gz") as archive:
        for member in archive:
            if member.name == KEY_MEMBER:
                handle = archive.extractfile(member)
                vault_key = handle.read().decode("ascii") if handle else None
                continue
            if not safe_member(member):
                raise RuntimeError(f"Unsafe archive entry: {member.name}")
            archive.extract(member, path=HOME)
    if not vault_key:
        raise RuntimeError("The protected-vault migration key is missing")
    subprocess.run(
        ["/usr/bin/security", "add-generic-password", "-U", "-a", getpass.getuser(), "-s", SERVICE, "-w", vault_key],
        check=True,
        capture_output=True,
    )


if __name__ == "__main__":
    main()

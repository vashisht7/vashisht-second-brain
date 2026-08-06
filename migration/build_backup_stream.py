#!/usr/bin/python3
"""Stream a compressed migration archive, including the vault key only in-stream."""

from __future__ import annotations

import getpass
import io
from pathlib import Path
import subprocess
import sys
import tarfile
import time


HOME = Path("/Users/vashishtdevasani")
ROOT = HOME / "PersonalAIData"
SERVICE = "com.vashisht.personal-ai.pii-vault"
EXCLUDED = (
    "PersonalAIData/40_models/mlx",
    "PersonalAIData/95_tools/venvs",
    "PersonalAIData/Apps/Vasisht2ndBrain/node_modules",
    "PersonalAIData/Apps/Vasisht2ndBrain/out",
)


def include(info: tarfile.TarInfo):
    if any(info.name == prefix or info.name.startswith(prefix + "/") for prefix in EXCLUDED):
        return None
    if "/__pycache__/" in info.name or info.name.endswith("/__pycache__"):
        return None
    return info


def main() -> None:
    result = subprocess.run(
        ["/usr/bin/security", "find-generic-password", "-a", getpass.getuser(), "-s", SERVICE, "-w"],
        capture_output=True,
        check=True,
    )
    vault_key = result.stdout.strip()
    with tarfile.open(fileobj=sys.stdout.buffer, mode="w|gz") as archive:
        archive.add(ROOT, arcname="PersonalAIData", recursive=True, filter=include)
        member = tarfile.TarInfo(".vashisht-migration/private_vault_key")
        member.size = len(vault_key)
        member.mode = 0o600
        member.mtime = int(time.time())
        archive.addfile(member, io.BytesIO(vault_key))


if __name__ == "__main__":
    main()

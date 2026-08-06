#!/usr/bin/env python3
"""
phone_brain/mac_mini/receiver.py

Watches index_incoming/ for new encrypted .pkg files,
decrypts them, and merges into the live ChromaDB.
Run once after each rsync — or keep running as a watcher.

Usage: python3 receiver.py
"""

import os
import sys
import json
import tarfile
import logging
import tempfile
import hashlib
import time
from pathlib import Path
from datetime import datetime

import chromadb
from cryptography.fernet import Fernet, InvalidToken

SCRIPT_DIR    = Path(__file__).parent
INCOMING_DIR  = SCRIPT_DIR / "index_incoming"
CHROMA_DIR    = SCRIPT_DIR / "chroma_db"
PROCESSED_DIR = SCRIPT_DIR / "index_processed"
LOG_FILE      = SCRIPT_DIR / "receiver.log"
KEY_FILE      = SCRIPT_DIR / ".enc_key"    # key is placed here by setup script

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)


def load_key() -> bytes:
    if not KEY_FILE.exists():
        log.error(f"Encryption key not found at {KEY_FILE}. Run setup_mac_mini.sh first.")
        sys.exit(1)
    return KEY_FILE.read_bytes().strip()


def process_package(pkg_path: Path, fernet: Fernet):
    log.info(f"Processing package: {pkg_path.name}")

    encrypted = pkg_path.read_bytes()

    try:
        decrypted = fernet.decrypt(encrypted)
    except InvalidToken:
        log.error(f"Decryption failed for {pkg_path.name} — wrong key or corrupted file")
        return False

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_tar = Path(tmpdir) / "index.tar.gz"
        tmp_tar.write_bytes(decrypted)

        with tarfile.open(tmp_tar, "r:gz") as tar:
            tar.extractall(tmpdir)

        incoming_chroma = Path(tmpdir) / "chroma_db"
        if not incoming_chroma.exists():
            log.error(f"No chroma_db found inside package {pkg_path.name}")
            return False

        # Merge incoming ChromaDB into live ChromaDB
        log.info("Merging incoming index into live ChromaDB...")
        incoming_client = chromadb.PersistentClient(path=str(incoming_chroma))
        live_client     = chromadb.PersistentClient(path=str(CHROMA_DIR))

        incoming_col = incoming_client.get_or_create_collection(
            "brain", metadata={"hnsw:space": "cosine"}
        )
        live_col = live_client.get_or_create_collection(
            "brain", metadata={"hnsw:space": "cosine"}
        )

        # Batch upsert in groups of 500
        total = incoming_col.count()
        log.info(f"Merging {total} chunks...")
        batch_size = 500
        offset = 0

        while offset < total:
            result = incoming_col.get(
                limit=batch_size,
                offset=offset,
                include=["embeddings", "documents", "metadatas"]
            )
            if not result["ids"]:
                break

            live_col.upsert(
                ids=result["ids"],
                embeddings=result["embeddings"],
                documents=result["documents"],
                metadatas=result["metadatas"],
            )
            offset += batch_size
            log.info(f"  Merged {min(offset, total)}/{total} chunks")

        log.info(f"✅ Merge complete. Live index now has {live_col.count()} chunks.")

    # Move processed package to archive
    PROCESSED_DIR.mkdir(exist_ok=True)
    pkg_path.rename(PROCESSED_DIR / pkg_path.name)
    manifest = pkg_path.with_suffix("").with_suffix(".manifest.json")
    if manifest.exists():
        manifest.rename(PROCESSED_DIR / manifest.name)

    log.info(f"Package archived to {PROCESSED_DIR}")
    return True


def run():
    INCOMING_DIR.mkdir(parents=True, exist_ok=True)
    CHROMA_DIR.mkdir(parents=True, exist_ok=True)

    key    = load_key()
    fernet = Fernet(key)

    log.info(f"Watching {INCOMING_DIR} for new packages...")

    while True:
        pkgs = sorted(INCOMING_DIR.glob("*.pkg"))
        if pkgs:
            for pkg in pkgs:
                process_package(pkg, fernet)
        else:
            log.info("No new packages. Sleeping 60s...")

        time.sleep(60)


if __name__ == "__main__":
    run()

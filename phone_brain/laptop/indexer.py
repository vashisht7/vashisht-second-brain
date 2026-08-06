#!/usr/bin/env python3
"""
phone_brain/laptop/indexer.py

Scans personal data folders, creates embeddings via Ollama (nomic-embed-text),
stores them in ChromaDB with privacy-safe metadata only (no paths, no content),
encrypts the snapshot, and packages it for rsync to Mac Mini.

Run: python3 indexer.py
"""

import os
import sys
import hashlib
import json
import shutil
import tarfile
import logging
import subprocess
import tempfile
import time
from datetime import datetime
from pathlib import Path

import chromadb
import requests
from cryptography.fernet import Fernet

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────
PERSONAL_DATA_ROOT = Path("/Users/vashishtdevasani/PersonalAIData")

SOURCE_FOLDERS = [
    PERSONAL_DATA_ROOT / "00_inbox",
    PERSONAL_DATA_ROOT / "10_raw_immutable",
    PERSONAL_DATA_ROOT / "20_normalized",
]

# PII vault included but tagged separately
PII_FOLDER = PERSONAL_DATA_ROOT / "05_private_pii" / "10_encrypted_documents"

SCRIPT_DIR       = Path(__file__).parent
LOCAL_CHROMA_DIR = SCRIPT_DIR / "chroma_local"
OUTPUT_DIR       = SCRIPT_DIR / "output"
STATE_FILE       = SCRIPT_DIR / "index_state.json"
LOG_FILE         = SCRIPT_DIR / "indexer.log"

KEYCHAIN_SERVICE = "com.vashisht.phonebrain.enckey"
OLLAMA_URL       = "http://localhost:11434/api/embeddings"
EMBED_MODEL      = "nomic-embed-text"
CHUNK_SIZE       = 512    # words per chunk (approx tokens)
CHUNK_OVERLAP    = 64     # word overlap between chunks
SUPPORTED_EXTS   = {".txt", ".md", ".pdf", ".docx", ".rtf", ".csv", ".json", ".yaml"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# ENCRYPTION KEY — macOS Keychain
# ─────────────────────────────────────────────────────────────────────────────
def get_or_create_key() -> bytes:
    result = subprocess.run(
        ["security", "find-generic-password", "-a", os.environ["USER"],
         "-s", KEYCHAIN_SERVICE, "-w"],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        return result.stdout.strip().encode()

    log.info("Generating new encryption key and storing in Keychain...")
    key = Fernet.generate_key()
    subprocess.run(
        ["security", "add-generic-password", "-a", os.environ["USER"],
         "-s", KEYCHAIN_SERVICE, "-w", key.decode()],
        check=True
    )
    log.info(f"Encryption key stored in Keychain under: {KEYCHAIN_SERVICE}")
    return key


# ─────────────────────────────────────────────────────────────────────────────
# STATE — incremental indexing via file content hashes
# ─────────────────────────────────────────────────────────────────────────────
def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"file_hashes": {}, "last_run": None}


def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


# ─────────────────────────────────────────────────────────────────────────────
# TEXT EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────
def extract_text(path: Path) -> str:
    ext = path.suffix.lower()
    try:
        if ext in {".txt", ".md", ".csv", ".json", ".yaml"}:
            return path.read_text(errors="ignore")
        elif ext == ".pdf":
            result = subprocess.run(
                ["pdftotext", str(path), "-"],
                capture_output=True, text=True, timeout=30
            )
            return result.stdout if result.returncode == 0 else ""
        elif ext == ".docx":
            result = subprocess.run(
                ["python3", "-c",
                 f"import docx; d=docx.Document(r'{path}'); print('\\n'.join(p.text for p in d.paragraphs))"],
                capture_output=True, text=True, timeout=30
            )
            return result.stdout
        elif ext == ".rtf":
            result = subprocess.run(
                ["textutil", "-convert", "txt", "-stdout", str(path)],
                capture_output=True, text=True, timeout=30
            )
            return result.stdout
    except Exception as e:
        log.warning(f"Failed to extract {path}: {e}")
    return ""


# ─────────────────────────────────────────────────────────────────────────────
# CHUNKING
# ─────────────────────────────────────────────────────────────────────────────
def chunk_text(text: str) -> list:
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i + CHUNK_SIZE])
        if chunk.strip():
            chunks.append(chunk)
        i += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


# ─────────────────────────────────────────────────────────────────────────────
# EMBEDDING via Ollama
# ─────────────────────────────────────────────────────────────────────────────
def embed(text: str) -> list:
    resp = requests.post(OLLAMA_URL, json={
        "model": EMBED_MODEL,
        "prompt": text
    }, timeout=60)
    resp.raise_for_status()
    return resp.json()["embedding"]


# ─────────────────────────────────────────────────────────────────────────────
# PRIVACY-SAFE METADATA — no paths, no filenames, no readable content
# ─────────────────────────────────────────────────────────────────────────────
def make_chunk_id(doc_hash: str, chunk_idx: int) -> str:
    return hashlib.sha256(f"{doc_hash}:{chunk_idx}".encode()).hexdigest()[:32]


def approx_date(path: Path) -> str:
    """Return only year-month to prevent exact timeline fingerprinting."""
    from datetime import datetime
    dt = datetime.fromtimestamp(path.stat().st_mtime)
    return dt.strftime("%Y-%m")


def file_type_tag(path: Path) -> str:
    return {
        ".md": "note", ".txt": "note",
        ".pdf": "document", ".docx": "document", ".rtf": "document",
        ".csv": "data", ".json": "data", ".yaml": "config",
    }.get(path.suffix.lower(), "other")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN INDEX ROUTINE
# ─────────────────────────────────────────────────────────────────────────────
def build_index():
    log.info("=== Phone Brain Indexer Starting ===")
    state = load_state()
    old_hashes = state["file_hashes"]
    new_hashes = {}

    LOCAL_CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    client     = chromadb.PersistentClient(path=str(LOCAL_CHROMA_DIR))
    collection = client.get_or_create_collection(
        name="brain",
        metadata={"hnsw:space": "cosine"}
    )

    all_folders = list(SOURCE_FOLDERS)
    if PII_FOLDER.exists():
        all_folders.append(PII_FOLDER)

    files_processed = 0
    files_skipped   = 0
    chunks_added    = 0

    for folder in all_folders:
        if not folder.exists():
            log.warning(f"Folder not found, skipping: {folder}")
            continue

        is_pii = (folder == PII_FOLDER)

        for path in folder.rglob("*"):
            if not path.is_file():
                continue
            if path.suffix.lower() not in SUPPORTED_EXTS:
                continue

            fhash = file_hash(path)
            new_hashes[str(path)] = fhash

            if old_hashes.get(str(path)) == fhash:
                files_skipped += 1
                continue

            log.info(f"Indexing: {path.name} ({'PII' if is_pii else 'vault'})")
            text = extract_text(path)
            if not text.strip():
                continue

            chunks   = chunk_text(text)
            doc_hash = fhash

            for i, chunk in enumerate(chunks):
                try:
                    embedding = embed(chunk)
                except Exception as e:
                    log.error(f"Embed failed for {path.name} chunk {i}: {e}")
                    continue

                chunk_id = make_chunk_id(doc_hash, i)

                # ⚠️ Privacy-safe: NO file path, NO filename, NO readable content in metadata
                metadata = {
                    "doc_hash":    doc_hash[:16],
                    "chunk_index": i,
                    "approx_date": approx_date(path),
                    "type":        "pii" if is_pii else file_type_tag(path),
                }

                collection.upsert(
                    ids=[chunk_id],
                    embeddings=[embedding],
                    documents=[chunk],
                    metadatas=[metadata]
                )
                chunks_added += 1

            files_processed += 1

    log.info(f"Indexed {files_processed} files | skipped {files_skipped} unchanged | {chunks_added} chunks total")

    state["file_hashes"] = new_hashes
    state["last_run"]    = datetime.utcnow().isoformat()
    state["chunk_count"] = collection.count()
    save_state(state)

    return LOCAL_CHROMA_DIR, state["chunk_count"]


# ─────────────────────────────────────────────────────────────────────────────
# ENCRYPT & PACKAGE
# ─────────────────────────────────────────────────────────────────────────────
def encrypt_and_package(chroma_dir: Path, chunk_count: int) -> Path:
    key    = get_or_create_key()
    fernet = Fernet(key)
    date_str = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tmp_tar = Path(tmp.name)

    with tarfile.open(tmp_tar, "w:gz") as tar:
        tar.add(chroma_dir, arcname="chroma_db")

    raw_bytes = tmp_tar.read_bytes()
    encrypted = fernet.encrypt(raw_bytes)
    tmp_tar.unlink()

    out_pkg = OUTPUT_DIR / f"brain_index_{date_str}.pkg"
    out_pkg.write_bytes(encrypted)

    manifest = {
        "created_at":  datetime.utcnow().isoformat(),
        "chunk_count": chunk_count,
        "version":     "1.0"
    }
    (OUTPUT_DIR / f"brain_index_{date_str}.manifest.json").write_text(
        json.dumps(manifest, indent=2)
    )

    log.info(f"Encrypted package: {out_pkg} ({out_pkg.stat().st_size // 1024} KB)")
    return out_pkg


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    try:
        chroma_dir, chunk_count = build_index()
        pkg = encrypt_and_package(chroma_dir, chunk_count)
        log.info(f"Index package ready: {pkg}")
        sys.exit(0)
    except Exception as e:
        log.error(f"Indexer failed: {e}", exc_info=True)
        sys.exit(1)

#!/usr/bin/env python3
"""Incremental local index and retrieval-backed Gemma chat."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import html
import json
import math
import os
import re
import sqlite3
import struct
import sys
from pathlib import Path
import urllib.request

from docx import Document
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
CONFIG_PATH = Path(os.environ.get("PERSONAL_AI_CONFIG", Path.home() / "SecondBrainData/config.json"))
CONFIG = json.loads(CONFIG_PATH.read_text())
INDEX = Path(CONFIG["index_path"])
TEXT_SUFFIXES = {
    ".txt", ".md", ".markdown", ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".kt",
    ".dart", ".swift", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".go", ".rs", ".sql",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".html", ".htm", ".css", ".xml", ".csv",
    ".json", ".ipynb"
}
MAX_CHUNKS_PER_FILE = 400
MAX_PDF_PAGES = 1000
SCAN_LOCK_HANDLE = None


def acquire_scan_lock():
    global SCAN_LOCK_HANDLE
    lock_path = INDEX.with_suffix(INDEX.suffix + ".scan.lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    SCAN_LOCK_HANDLE = lock_path.open("a+")
    try:
        fcntl.flock(SCAN_LOCK_HANDLE.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except BlockingIOError:
        SCAN_LOCK_HANDLE.close()
        SCAN_LOCK_HANDLE = None
        return False


def database():
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(INDEX)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, indexed_at TEXT DEFAULT CURRENT_TIMESTAMP)")
    con.execute("CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY, path TEXT NOT NULL, locator TEXT, title TEXT, text TEXT NOT NULL, embedding BLOB NOT NULL)")
    con.execute("CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path)")
    con.execute("CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(title,text,content='chunks',content_rowid='id')")
    con.execute("CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    stored_model = con.execute("SELECT value FROM metadata WHERE key='embedding_model'").fetchone()
    chunk_count = con.execute("SELECT count(*) FROM chunks").fetchone()[0]
    if stored_model and stored_model[0] != CONFIG["embedding_model"] and chunk_count:
        raise RuntimeError(
            f"Index uses {stored_model[0]}, but configuration requests {CONFIG['embedding_model']}. "
            "Use a separate empty index when changing embedding models."
        )
    con.execute(
        "INSERT OR REPLACE INTO metadata(key,value) VALUES('embedding_model',?)",
        (CONFIG["embedding_model"],),
    )
    con.commit()
    return con


def allowed(path: Path):
    # Index Voice Memos from the normalized aggregate only. The individual JSON
    # artifacts remain available for auditing and future reprocessing.
    if path.parent.name == "audio_transcripts" and path.name != "voice_memos.jsonl":
        return False
    lowered = str(path).casefold()
    name = path.name.casefold()
    if any(term.casefold() in lowered for term in CONFIG["excluded_path_terms"]):
        return False
    if any(term.casefold() in name for term in CONFIG["excluded_name_terms"]):
        return False
    if path.name.startswith("."):
        return False
    suffix = path.suffix.casefold()
    size_limit = 35_000_000 if suffix in {".pdf", ".docx", ".jsonl"} else 10_000_000
    if path.stat().st_size > size_limit:
        return False
    return suffix in TEXT_SUFFIXES | {".pdf", ".docx", ".jsonl"}


def fingerprint(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clean(value: str):
    value = html.unescape(re.sub(r"<[^>]+>", " ", value))
    value = value.replace("\x00", " ")
    return re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", value)).strip()


def sensitive_content(*values: str):
    combined = " ".join(values).casefold()
    return any(term.casefold() in combined for term in CONFIG.get("excluded_content_terms", []))


def whatsapp_records(path: Path):
    chats = {}
    with path.open(encoding="utf-8", errors="replace") as handle:
        for line_number, line in enumerate(handle, 1):
            try:
                item = json.loads(line)
            except Exception:
                continue
            body = clean(str(item.get("text") or ""))
            if not body or sensitive_content(body):
                continue
            chat = str(item.get("chat_session") or "unknown")
            item["_line"] = line_number
            item["_body"] = body
            chats.setdefault(chat, []).append(item)
    for items in chats.values():
        items.sort(key=lambda item: item.get("created_at") or "")
        for offset in range(0, len(items), 8):
            group = items[offset:offset + 8]
            partner = str(group[0].get("partner") or "Unknown")
            lines = []
            for item in group:
                speaker = os.environ.get("SECOND_BRAIN_OWNER_NAME", "Owner") if item.get("authored_by_me") else partner
                timestamp = str(item.get("created_at") or "")
                lines.append(f"{timestamp} — {speaker}: {item['_body']}")
            body = "\n".join(lines)
            first_line, last_line = group[0]["_line"], group[-1]["_line"]
            yield f"WhatsApp with {partner}", body, f"lines {first_line}-{last_line}"


def records(path: Path):
    suffix = path.suffix.casefold()
    if suffix == ".jsonl":
        if path.name.startswith("whatsapp_"):
            yield from whatsapp_records(path)
            return
        with path.open(encoding="utf-8", errors="replace") as handle:
            for line_number, line in enumerate(handle, 1):
                try:
                    item = json.loads(line)
                except Exception:
                    continue
                body = item.get("text") or item.get("body") or item.get("snippet") or ""
                subject = item.get("subject") or item.get("partner") or item.get("source_type") or path.stem
                if body and not sensitive_content(str(subject), str(body)):
                    yield str(subject), clean(str(body)), f"line {line_number}"
        return
    if suffix == ".pdf":
        reader = PdfReader(str(path))
        for page_number in range(1, min(len(reader.pages), MAX_PDF_PAGES) + 1):
            page = reader.pages[page_number - 1]
            body = clean(page.extract_text() or "")
            if body and not sensitive_content(body):
                yield path.stem, body, f"page {page_number}"
        return
    if suffix == ".docx":
        document = Document(str(path))
        body = clean("\n".join(paragraph.text for paragraph in document.paragraphs))
        if body and not sensitive_content(body):
            yield path.stem, body, "document"
        return
    raw = path.read_text(encoding="utf-8", errors="replace")
    if suffix == ".ipynb":
        try:
            notebook = json.loads(raw)
            raw = "\n".join("".join(cell.get("source", [])) for cell in notebook.get("cells", []))
        except Exception:
            pass
    body = clean(raw)
    if body and not sensitive_content(body):
        yield path.stem, body, "file"


def split_text(text: str, size=1200, overlap=180):
    if len(text) <= size:
        return [text]
    pieces = []
    start = 0
    while start < len(text):
        end = min(len(text), start + size)
        if end < len(text):
            boundary = max(text.rfind("\n", start, end), text.rfind(". ", start, end))
            if boundary > start + size // 2:
                end = boundary + 1
        pieces.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(start + 1, end - overlap)
    return [piece for piece in pieces if piece]


def post(endpoint: str, payload: dict):
    request = urllib.request.Request(
        CONFIG["ollama_url"] + endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=600) as response:
        return json.load(response)


def embeddings(texts):
    values = []
    for offset in range(0, len(texts), 32):
        prefix = CONFIG.get("document_prefix", "search_document: ")
        batch = [prefix + text for text in texts[offset:offset + 32]]
        payload = {"model": CONFIG["embedding_model"], "input": batch}
        if CONFIG.get("embedding_options"):
            payload["options"] = CONFIG["embedding_options"]
        values.extend(post("/api/embed", payload)["embeddings"])
    return values


def pack(vector):
    return struct.pack(f"<{len(vector)}f", *vector)


def unpack(payload):
    return struct.unpack(f"<{len(payload) // 4}f", payload)


def scan():
    if not acquire_scan_lock():
        print(json.dumps({"state": "already_running"}))
        return
    con = database()
    existing = {row[0]: row[1] for row in con.execute("SELECT path,fingerprint FROM files")}
    seen = set()
    changed = skipped = errors = chunks_added = 0
    for root_name in CONFIG["sources"]:
        root = Path(root_name)
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            try:
                if not allowed(path):
                    continue
                key = str(path)
                seen.add(key)
                mark = fingerprint(path)
                if existing.get(key) == mark:
                    skipped += 1
                    continue
                extracted = []
                for title, body, locator in records(path):
                    for number, piece in enumerate(split_text(body)):
                        extracted.append((title, piece, f"{locator}; chunk {number + 1}"))
                        if len(extracted) >= MAX_CHUNKS_PER_FILE:
                            break
                    if len(extracted) >= MAX_CHUNKS_PER_FILE:
                        break
                if not extracted:
                    continue
                vectors = embeddings([item[1] for item in extracted])
                old_ids = [row[0] for row in con.execute("SELECT id FROM chunks WHERE path=?", (key,))]
                for old_id in old_ids:
                    con.execute("DELETE FROM chunks_fts WHERE rowid=?", (old_id,))
                con.execute("DELETE FROM chunks WHERE path=?", (key,))
                for (title, body, locator), vector in zip(extracted, vectors):
                    cursor = con.execute("INSERT INTO chunks(path,locator,title,text,embedding) VALUES(?,?,?,?,?)", (key, locator, title, body, pack(vector)))
                    con.execute("INSERT INTO chunks_fts(rowid,title,text) VALUES(?,?,?)", (cursor.lastrowid, title, body))
                con.execute("INSERT OR REPLACE INTO files(path,fingerprint) VALUES(?,?)", (key, mark))
                con.commit()
                changed += 1
                chunks_added += len(extracted)
            except Exception:
                errors += 1
    for missing in set(existing).difference(seen):
        if not any(missing.startswith(source) for source in CONFIG["sources"]):
            continue
        old_ids = [row[0] for row in con.execute("SELECT id FROM chunks WHERE path=?", (missing,))]
        for old_id in old_ids:
            con.execute("DELETE FROM chunks_fts WHERE rowid=?", (old_id,))
        con.execute("DELETE FROM chunks WHERE path=?", (missing,))
        con.execute("DELETE FROM files WHERE path=?", (missing,))
    con.commit()
    total = con.execute("SELECT count(*) FROM chunks").fetchone()[0]
    con.close()
    print(json.dumps({"changed_files": changed, "unchanged_files": skipped, "new_chunks": chunks_added, "errors": errors, "total_chunks": total}))


def cosine(left, right):
    dot = sum(a * b for a, b in zip(left, right))
    norm = math.sqrt(sum(a * a for a in left) * sum(b * b for b in right))
    return dot / norm if norm else 0.0


def retrieve(query: str, limit=8):
    con = database()
    prefix = CONFIG.get("query_prefix", "search_query: ")
    payload = {"model": CONFIG["embedding_model"], "input": [prefix + query]}
    if CONFIG.get("embedding_options"):
        payload["options"] = CONFIG["embedding_options"]
    vector = post("/api/embed", payload)["embeddings"][0]
    scored = []
    for row in con.execute("SELECT id,path,locator,title,text,embedding FROM chunks"):
        scored.append((cosine(vector, unpack(row[5])), row[:5]))
    scored.sort(reverse=True, key=lambda item: item[0])
    # Hybrid retrieval: semantic similarity handles paraphrases and mixed
    # language; FTS adds a controlled boost for exact names, dates, and IDs.
    exact_ranks = {}
    terms = [term for term in re.findall(r"[^\W_]+", query, flags=re.UNICODE) if len(term) > 1]
    if terms:
        expression = " OR ".join('"' + term.replace('"', '""') + '"' for term in terms[:12])
        try:
            for rank, (row_id,) in enumerate(
                con.execute(
                    "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT 60",
                    (expression,),
                ),
                1,
            ):
                exact_ranks[row_id] = rank
        except sqlite3.OperationalError:
            pass
    rescored = []
    for semantic_score, row in scored:
        exact_rank = exact_ranks.get(row[0])
        exact_boost = 0.12 / (1.0 + (exact_rank - 1) / 5.0) if exact_rank else 0.0
        rescored.append((semantic_score + exact_boost, row))
    rescored.sort(reverse=True, key=lambda item: item[0])
    con.close()
    return rescored[:limit]


def query_command(query: str, as_json=False):
    found = retrieve(query)
    if as_json:
        payload = []
        for rank, (score, row) in enumerate(found, 1):
            _, path, locator, title, body = row
            payload.append({"rank": rank, "score": score, "path": path, "locator": locator, "title": title, "text": body})
        print(json.dumps(payload, ensure_ascii=False))
        return
    for rank, (score, row) in enumerate(found, 1):
        _, path, locator, title, body = row
        print(f"[{rank}] {score:.3f} {title} — {path} ({locator})\n{body[:500]}\n")


def ask(query: str):
    found = retrieve(query)
    sources = []
    for number, (_, row) in enumerate(found, 1):
        _, path, locator, title, body = row
        sources.append(f"[S{number}] {title}\nSource: {path} ({locator})\n{body}")
    prompt = """Answer using only the supplied personal sources. If the answer is not present, say so. Cite claims with [S1], [S2], etc. Never reveal hidden reasoning.\n\n""" + "\n\n".join(sources) + f"\n\nQuestion: {query}"
    result = post("/api/chat", {"model": CONFIG["chat_model"], "stream": False, "messages": [{"role": "user", "content": prompt}], "options": {"num_ctx": 8192}})
    print(result["message"]["content"])


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("scan")
    query = commands.add_parser("query"); query.add_argument("text"); query.add_argument("--json", action="store_true")
    answer = commands.add_parser("ask"); answer.add_argument("text")
    args = parser.parse_args()
    if args.command == "scan": scan()
    elif args.command == "query": query_command(args.text, args.json)
    else: ask(args.text)


if __name__ == "__main__":
    main()

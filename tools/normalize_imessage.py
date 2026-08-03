#!/usr/bin/python3
"""Read Apple Messages locally and refresh privacy-filtered retrieval inputs."""

from __future__ import annotations

import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess


ROOT = Path(os.environ.get("SECOND_BRAIN_DATA_ROOT", Path.home() / "SecondBrainData")).expanduser()
MESSAGES_DB = Path.home() / "Library/Messages/chat.db"
CONTACTS_DB = Path.home() / "Library/Application Support/AddressBook/AddressBook-v22.abcddb"
OUTPUT = ROOT / "normalized/messages/imessage_live"
STATUS = ROOT / "runtime/index/imessage_status.json"
LOCK = ROOT / "runtime/index/imessage_normalize.lock"
INDEXER = Path(__file__).resolve().parent / "second_brain.py"
APPLE_EPOCH = 978307200
GROUP_SIZE = 8
RECORDS_PER_SHARD = 200


def readonly(path: Path):
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def clean_text(value):
    value = str(value or "").replace("\ufffc", " ").replace("\x00", " ")
    value = "".join(character if character in "\n\t" or ord(character) >= 32 else " " for character in value)
    return re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", value)).strip()


def attributed_text(payload):
    if not payload or b"NSString" not in payload:
        return ""
    value = payload.split(b"NSString", 1)[1]
    if len(value) < 6:
        return ""
    value = value[5:]
    if value[0] == 0x81 and len(value) >= 3:
        length, start = int.from_bytes(value[1:3], "little"), 3
    elif value[0] == 0x82 and len(value) >= 5:
        length, start = int.from_bytes(value[1:5], "little"), 5
    else:
        length, start = value[0], 1
    return clean_text(value[start:start + length].decode("utf-8", "replace").replace("\ufffd", ""))


def normalized_handle(value):
    value = str(value or "").strip().casefold()
    if "@" in value:
        return value
    digits = re.sub(r"\D", "", value)
    return digits[-10:] if len(digits) >= 10 else digits


def contact_names():
    names = {}
    if not CONTACTS_DB.exists():
        return names
    try:
        with readonly(CONTACTS_DB) as con:
            records = {}
            for row in con.execute("SELECT Z_PK,ZNAME,ZFIRSTNAME,ZLASTNAME,ZORGANIZATION FROM ZABCDRECORD"):
                label = clean_text(row[1] or " ".join(filter(None, (row[2], row[3]))) or row[4])
                if label:
                    records[row[0]] = label
            for owner, number in con.execute("SELECT ZOWNER,ZFULLNUMBER FROM ZABCDPHONENUMBER WHERE ZFULLNUMBER IS NOT NULL"):
                if owner in records and normalized_handle(number):
                    names[normalized_handle(number)] = records[owner]
            for owner, address in con.execute("SELECT ZOWNER,ZADDRESS FROM ZABCDEMAILADDRESS WHERE ZADDRESS IS NOT NULL"):
                if owner in records and normalized_handle(address):
                    names[normalized_handle(address)] = records[owner]
    except sqlite3.Error:
        # Contact names are optional; unresolved handles become anonymous labels.
        return {}
    return names


def timestamp(raw):
    value = int(raw or 0)
    seconds = value / 1_000_000_000 if abs(value) > 10_000_000_000 else value
    try:
        return dt.datetime.fromtimestamp(APPLE_EPOCH + seconds, dt.timezone.utc).isoformat()
    except Exception:
        return ""


def anonymous_label(value):
    digest = hashlib.sha256(str(value or "unknown").encode()).hexdigest()[:8]
    return f"Contact {digest}"


def write_if_changed(path: Path, content: str):
    if path.exists() and path.read_text(encoding="utf-8", errors="replace") == content:
        return False
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    return True


def normalize():
    if not MESSAGES_DB.exists():
        raise FileNotFoundError("Apple Messages database is unavailable")
    contacts = contact_names()
    with readonly(MESSAGES_DB) as con:
        con.row_factory = sqlite3.Row
        participants = {}
        try:
            for chat_id, handle in con.execute(
                "SELECT chj.chat_id,h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID=chj.handle_id"
            ):
                participants.setdefault(chat_id, []).append(handle)
        except sqlite3.Error:
            pass
        rows = con.execute("""
            SELECT m.ROWID AS message_id,m.guid,m.text,m.attributedBody,m.date,m.is_from_me,m.service,
                   c.ROWID AS chat_id,c.guid AS chat_guid,c.display_name,c.chat_identifier,h.id AS handle
            FROM message m
            LEFT JOIN chat_message_join cmj ON cmj.message_id=m.ROWID
            LEFT JOIN chat c ON c.ROWID=cmj.chat_id
            LEFT JOIN handle h ON h.ROWID=m.handle_id
            WHERE m.item_type=0 AND m.is_system_message=0
              AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
            GROUP BY m.ROWID
            ORDER BY m.date,m.ROWID
        """).fetchall()

    chats = {}
    for row in rows:
        body = clean_text(row["text"]) or attributed_text(row["attributedBody"])
        if not body:
            continue
        candidate_handles = participants.get(row["chat_id"], [])
        resolved = []
        for candidate in candidate_handles + [row["chat_identifier"], row["handle"]]:
            name = contacts.get(normalized_handle(candidate))
            if name and name not in resolved:
                resolved.append(name)
        label = clean_text(row["display_name"]) or ", ".join(resolved[:4])
        label = label or anonymous_label(row["chat_guid"] or row["chat_id"] or row["handle"])
        chat_key = str(row["chat_guid"] or row["chat_id"] or row["handle"] or "unknown")
        chats.setdefault(chat_key, {"label": label, "messages": []})["messages"].append({
            "id": str(row["guid"] or row["message_id"]),
            "created_at": timestamp(row["date"]),
            "authored_by_me": bool(row["is_from_me"]),
            "text": body,
            "service": clean_text(row["service"]),
        })

    records = []
    for chat_key, chat in chats.items():
        messages = chat["messages"]
        for offset in range(0, len(messages), GROUP_SIZE):
            group = messages[offset:offset + GROUP_SIZE]
            lines = []
            for message in group:
                speaker = os.environ.get("SECOND_BRAIN_OWNER_NAME", "Owner") if message["authored_by_me"] else chat["label"]
                lines.append(f"{message['created_at']} — {speaker}: {message['text']}")
            records.append({
                "source_type": "imessage_live",
                "source_ids": [message["id"] for message in group],
                "chat_session": hashlib.sha256(chat_key.encode()).hexdigest()[:16],
                "partner": chat["label"],
                "subject": f"Messages with {chat['label']}",
                "created_at": group[-1]["created_at"],
                "text": "\n".join(lines),
            })
    records.sort(key=lambda item: item["created_at"])

    OUTPUT.mkdir(parents=True, exist_ok=True, mode=0o700)
    desired = set()
    changed = False
    for offset in range(0, len(records), RECORDS_PER_SHARD):
        path = OUTPUT / f"imessage_live_{offset // RECORDS_PER_SHARD + 1:04d}.jsonl"
        content = "".join(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n" for item in records[offset:offset + RECORDS_PER_SHARD])
        desired.add(path)
        changed = write_if_changed(path, content) or changed
    for stale in OUTPUT.glob("imessage_live_*.jsonl"):
        if stale not in desired:
            stale.unlink()
            changed = True

    STATUS.parent.mkdir(parents=True, exist_ok=True)
    status = {
        "state": "ready",
        "refresh_state": "ready",
        "messages": sum(len(chat["messages"]) for chat in chats.values()),
        "conversations": len(chats),
        "records": len(records),
        "shards": len(desired),
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }
    write_if_changed(STATUS, json.dumps(status, indent=2) + "\n")
    if changed:
        subprocess.Popen([str(INDEXER), "scan"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return status


def main():
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with LOCK.open("a+") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        try:
            result = normalize()
        except Exception as exc:
            STATUS.parent.mkdir(parents=True, exist_ok=True)
            previous = {}
            if STATUS.exists():
                try:
                    previous = json.loads(STATUS.read_text())
                except (OSError, json.JSONDecodeError):
                    previous = {}
            error_text = str(exc)
            status = {
                **previous,
                "state": "ready" if previous.get("messages") else "error",
                "refresh_state": "permission_required" if "authorization denied" in error_text.lower() else "error",
                "refresh_error": error_text,
                "refresh_attempted_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            }
            write_if_changed(STATUS, json.dumps(status, indent=2) + "\n")
            raise
        print(json.dumps(result))


if __name__ == "__main__":
    main()

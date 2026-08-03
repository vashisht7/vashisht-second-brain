#!/usr/bin/python3
"""Portable, local-only knowledge graph built from the second-brain SQLite index."""

from __future__ import annotations

from array import array
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3


MESSAGE_TOPICS = {"WhatsApp Conversations", "Apple Messages"}
STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "my",
    "of", "on", "or", "the", "to", "with", "your", "document", "documents", "file", "files",
    "message", "messages", "whatsapp", "apple", "email", "notes", "project", "readme", "untitled",
    "vashisht", "devasani", "personal", "content", "data",
}


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", str(value).casefold()).strip("-")


class LocalKnowledgeGraph:
    schema_version = 1

    def __init__(self, config_path, state_path):
        self.config_path = Path(config_path)
        self.state_path = Path(state_path)
        self._cache = None
        self._embedding_cache = {}
        self._init_state()

    def _state(self):
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(self.state_path)
        con.row_factory = sqlite3.Row
        return con

    def _init_state(self):
        with self._state() as con:
            con.executescript("""
                CREATE TABLE IF NOT EXISTS contact_aliases(
                    document_id TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS summaries(
                    item_key TEXT PRIMARY KEY, summary TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS preferences(
                    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
                );
            """)
            con.execute(
                "INSERT INTO preferences(key,value,updated_at) VALUES('schema_version',?,?) "
                "ON CONFLICT(key) DO NOTHING", (str(self.schema_version), utc_now())
            )
        self.state_path.chmod(0o600)

    def config(self):
        return json.loads(self.config_path.read_text()) if self.config_path.exists() else {}

    def index_path(self):
        return Path(self.config().get("index_path", ""))

    @staticmethod
    def topic_for(path, title):
        value = f"{path} {title}".casefold()
        if any(term in value for term in ("whatsapp", "wa_chat")):
            return "WhatsApp Conversations"
        if any(term in value for term in ("imessage", "apple_messages", "/messages/chat")):
            return "Apple Messages"
        if any(term in value for term in ("gmail", "email", "mailbox", ".mbox")):
            return "Email"
        if any(term in value for term in ("google keep", "keep_notes", "apple_notes", "/notes/")):
            return "Notes & Ideas"
        if any(term in value for term in ("audio_transcript", "voice memo", "voicememo", "/audio/", "transcript")):
            return "Voice & Transcripts"
        if any(term in value for term in ("ai-102", "course", "study", "certification", "exam", "university", "college", "assignment")):
            return "Study & Certifications"
        if any(term in value for term in ("story", "book", "chapter", "love letter", "personal writing", "poem")):
            return "Personal Writing"
        if any(term in value for term in ("resume", "résumé", "career", "professional", "work document", "job", "interview")):
            return "Career & Professional"
        code_extensions = (".py", ".js", ".ts", ".tsx", ".jsx", ".swift", ".java", ".kt", ".go", ".rs", ".sql", ".ipynb")
        if any(term in value for term in ("/github/", "/projects/", "readme", "package.json")) or str(path).casefold().endswith(code_extensions):
            return "Software Projects"
        if any(term in value for term in ("photo", "image", "location", "places", "metadata")):
            return "Photos & Places"
        return "Documents & Downloads"

    @staticmethod
    def document_id(topic, path, title):
        # Keep graph annotations attached when the macOS account name changes.
        portable_path = re.sub(r"^/Users/[^/]+/", "~/", str(path))
        identity = f"{topic}\0{title}" if topic in MESSAGE_TOPICS else f"{topic}\0{portable_path}\0{title}"
        return hashlib.sha256(identity.encode()).hexdigest()[:20]

    @staticmethod
    def tokens(value):
        return [token for token in re.findall(r"[a-z][a-z0-9+#.-]{2,}", str(value).casefold()) if token not in STOP_WORDS]

    @classmethod
    def subtopic_for(cls, topic, path, title, excerpt):
        value = f"{path} {title} {excerpt}".casefold()
        rules = {
            "Study & Certifications": (
                ("ai-102", "AI-102"), ("azure", "Azure AI"), ("openai", "Generative AI"),
                ("computer vision", "Computer Vision"), ("nlp", "Language AI"),
                ("exam", "Exam Preparation"), ("course", "Course Materials"),
            ),
            "Software Projects": (
                ("studybuddy", "StudyBuddy"), ("vashisht2ndbrain", "Second Brain"),
                ("swift", "Apple Development"), ("flutter", "Flutter"),
                ("react", "Web Development"), ("python", "Python Projects"), ("github", "GitHub Projects"),
            ),
            "Email": (
                ("job", "Jobs & Recruiting"), ("recruit", "Jobs & Recruiting"), ("interview", "Jobs & Recruiting"),
                ("receipt", "Receipts & Orders"), ("order", "Receipts & Orders"),
                ("university", "Education"), ("course", "Education"), ("travel", "Travel"), ("work", "Work"),
            ),
            "Documents & Downloads": (
                (".pdf", "PDF Documents"), (".docx", "Word Documents"), (".ppt", "Presentations"),
                (".xlsx", "Spreadsheets"), (".csv", "Datasets"), ("invoice", "Receipts & Invoices"),
            ),
            "Career & Professional": (("resume", "Resumes"), ("interview", "Interview Preparation"), ("job", "Job Applications")),
            "Personal Writing": (("love letter", "Letters"), ("story", "Stories"), ("book", "Books & Chapters"), ("chapter", "Books & Chapters")),
            "Photos & Places": (("location", "Location History"), ("metadata", "Photo Metadata")),
            "Notes & Ideas": (("keep", "Google Keep"), ("apple", "Apple Notes")),
        }
        for needle, label in rules.get(topic, ()):
            if needle in value:
                return label
        if topic in MESSAGE_TOPICS:
            return "People & Groups"
        defaults = {
            "Study & Certifications": "Other Study Materials", "Software Projects": "Other Projects",
            "Email": "Other Email", "Documents & Downloads": "Other Documents",
            "Career & Professional": "Other Professional Files", "Personal Writing": "Other Writing",
            "Voice & Transcripts": "Voice Memos", "Photos & Places": "Other Media", "Notes & Ideas": "Other Notes",
        }
        return defaults.get(topic, "Other")

    @staticmethod
    def safe_label(path, title, alias=None):
        if alias:
            return alias
        label = re.sub(r"\s+", " ", str(title or Path(path).stem)).strip()
        label = re.sub(r"^(?:WhatsApp with|Messages with)\s+", "", label, flags=re.I)
        if re.fullmatch(r"Contact\s+[0-9a-f]{8}", label, re.I) or re.search(r"(?:\+?\d[\s().\-\u2011]*){7,}", label):
            return "Unknown contact"
        return label[:100] or Path(path).name

    @staticmethod
    def modified_time(paths):
        values = []
        for path in paths:
            try:
                values.append(Path(path).stat().st_mtime)
            except OSError:
                pass
        return dt.datetime.fromtimestamp(max(values), dt.timezone.utc).isoformat() if values else None

    def build(self, force=False):
        index = self.index_path()
        if not index.is_file():
            return {"stamp": 0, "topics": [], "files": {}, "documents": {}, "duplicates": 0}
        stamp = index.stat().st_mtime_ns
        if not force and self._cache and self._cache["stamp"] == stamp:
            return self._cache
        if self._cache and self._cache["stamp"] != stamp:
            self._embedding_cache.clear()
        config = self.config()
        excluded = tuple(config.get("excluded_path_terms", [])) + ("/.venv/", "/site-packages/", "/vendor/", "/__pycache__/", "/out/")
        with sqlite3.connect(index) as con:
            rows = con.execute("""
                SELECT c.path,COALESCE(NULLIF(c.title,''),c.path),g.chunks,c.id,substr(c.text,1,2400)
                FROM chunks c JOIN (
                    SELECT path,title,min(id) AS first_id,count(*) AS chunks FROM chunks GROUP BY path,title
                ) g ON c.id=g.first_id
                ORDER BY c.title COLLATE NOCASE
            """).fetchall()
        with self._state() as con:
            aliases = {row["document_id"]: row["name"] for row in con.execute("SELECT document_id,name FROM contact_aliases")}
            summaries = {row["item_key"]: row["summary"] for row in con.execute("SELECT item_key,summary FROM summaries")}
        grouped, documents, fingerprints = {}, {}, {}
        duplicates = 0
        for path, title, chunks, first_id, excerpt in rows:
            path, title, excerpt = str(path), str(title), str(excerpt or "")
            if any(term.casefold() in path.casefold() for term in excluded):
                continue
            topic = self.topic_for(path, title)
            document_id = self.document_id(topic, path, title)
            existing = documents.get(document_id)
            if existing:
                existing["chunks"] += chunks
                if path not in existing["paths"]:
                    existing["paths"].append(path)
                continue
            fingerprint = hashlib.sha256(re.sub(r"\s+", " ", excerpt).casefold().encode()).hexdigest() if len(excerpt) > 120 and topic not in MESSAGE_TOPICS else None
            if fingerprint and fingerprint in fingerprints:
                canonical = documents[fingerprints[fingerprint]]
                canonical["duplicates"] += 1
                canonical["chunks"] += chunks
                if path not in canonical["paths"]:
                    canonical["paths"].append(path)
                duplicates += 1
                continue
            item = {
                "id": document_id, "topic": topic, "raw_title": title, "paths": [path], "chunks": chunks,
                "kind": "conversation" if topic in MESSAGE_TOPICS else (Path(path).suffix.lower().lstrip(".") or "document"),
                "virtual": topic in MESSAGE_TOPICS, "first_chunk_id": first_id, "excerpt": excerpt,
                "duplicates": 0, "confidence": 0.98 if Path(path).exists() else 0.72,
            }
            item["title"] = self.safe_label(path, title, aliases.get(document_id))
            item["subtopic"] = self.subtopic_for(topic, path, title, excerpt)
            item["updatedAt"] = self.modified_time(item["paths"])
            item["summary"] = summaries.get(f"document:{document_id}")
            item["keywords"] = list(dict.fromkeys(self.tokens(f"{title} {excerpt[:600]}")))[:12]
            documents[document_id] = item
            grouped.setdefault(topic, []).append(item)
            if fingerprint:
                fingerprints[fingerprint] = document_id
        for item in documents.values():
            item["updatedAt"] = self.modified_time(item["paths"])
            item["confidence"] = 0.98 if any(Path(path).exists() for path in item["paths"]) else 0.72
        topics = []
        for name, files in grouped.items():
            files.sort(key=lambda item: (-item["chunks"], item["title"].casefold()))
            subtopics = {}
            for item in files:
                subtopics[item["subtopic"]] = subtopics.get(item["subtopic"], 0) + 1
            topics.append({
                "id": slug(name), "name": name, "count": len(files),
                "subtopics": [{"name": key, "count": value} for key, value in sorted(subtopics.items(), key=lambda pair: (-pair[1], pair[0]))[:12]],
                "summary": summaries.get(f"topic:{name}"),
            })
        topics.sort(key=lambda item: (-item["count"], item["name"]))
        self._cache = {"stamp": stamp, "topics": topics, "files": grouped, "documents": documents, "duplicates": duplicates}
        return self._cache

    @staticmethod
    def public_item(item, title=None):
        return {
            "id": item["id"], "title": title or item["title"], "topic": item["topic"], "subtopic": item["subtopic"],
            "chunks": item["chunks"], "kind": item["kind"], "virtual": item["virtual"],
            "path": None if item["virtual"] else item["paths"][0], "canRename": item["virtual"],
            "confidence": item["confidence"], "updatedAt": item["updatedAt"], "duplicates": item["duplicates"],
            "summary": item.get("summary"),
        }

    def overview(self):
        graph = self.build()
        return {"topics": graph["topics"], "duplicatesMerged": graph["duplicates"], "schemaVersion": self.schema_version}

    def topic_files(self, topic, query="", subtopic="", offset=0, limit=150):
        files = self.build()["files"].get(topic, [])
        if query:
            words = self.tokens(query)
            files = [item for item in files if all(word in f"{item['title']} {item['subtopic']} {' '.join(item['keywords'])}".casefold() for word in words)]
        if subtopic:
            files = [item for item in files if item["subtopic"] == subtopic]
        selected = files[offset:offset + min(limit, 250)]
        unknown = 0
        public = []
        for item in selected:
            title = item["title"]
            if title == "Unknown contact":
                unknown += 1
                title = f"Unknown contact {unknown}"
            public.append(self.public_item(item, title))
        return {"topic": topic, "total": len(files), "files": public}

    def search(self, query, limit=80):
        terms = self.tokens(query)
        if not terms:
            return []
        scored = []
        for item in self.build()["documents"].values():
            haystack = f"{item['title']} {item['topic']} {item['subtopic']} {' '.join(item['keywords'])}".casefold()
            score = sum(3 if term in item["title"].casefold() else 1 for term in terms if term in haystack)
            if score:
                scored.append((score, item["chunks"], item))
        scored.sort(key=lambda row: (row[0], row[1]), reverse=True)
        return [self.public_item(item) for _, _, item in scored[:limit]]

    def _embedding(self, chunk_id):
        if chunk_id in self._embedding_cache:
            return self._embedding_cache[chunk_id]
        with sqlite3.connect(self.index_path()) as con:
            row = con.execute("SELECT embedding FROM chunks WHERE id=?", (chunk_id,)).fetchone()
        if not row:
            return None
        values = array("f")
        values.frombytes(row[0])
        self._embedding_cache[chunk_id] = values
        return values

    @staticmethod
    def cosine(left, right):
        if not left or not right or len(left) != len(right):
            return 0.0
        dot = sum(a * b for a, b in zip(left, right))
        norm = math.sqrt(sum(a * a for a in left) * sum(b * b for b in right))
        return dot / norm if norm else 0.0

    def related(self, document_id, limit=8):
        graph = self.build()
        source = graph["documents"].get(document_id)
        if not source:
            raise ValueError("Document was not found")
        source_vector = self._embedding(source["first_chunk_id"])
        candidates = []
        for topic in graph["topics"]:
            candidates.extend(graph["files"].get(topic["name"], [])[:45])
        results = []
        similarity_floor = 0.62 if source["virtual"] else 0.48
        for candidate in candidates:
            if candidate["id"] == source["id"]:
                continue
            if source["virtual"] and candidate["virtual"]:
                continue
            similarity = self.cosine(source_vector, self._embedding(candidate["first_chunk_id"]))
            shared = sorted(set(source["keywords"]).intersection(candidate["keywords"]))[:5]
            same_subtopic = source["subtopic"] == candidate["subtopic"]
            if similarity < similarity_floor and not (same_subtopic and len(shared) >= 2):
                continue
            reasons = []
            if similarity >= similarity_floor:
                reasons.append(f"{round(similarity * 100)}% local embedding similarity")
            if same_subtopic:
                reasons.append(f"same subtopic: {source['subtopic']}")
            if shared:
                reasons.append("shared terms: " + ", ".join(shared))
            results.append((similarity + len(shared) * 0.03, candidate, reasons))
        results.sort(key=lambda row: row[0], reverse=True)
        return [{**self.public_item(item), "relationship": "; ".join(reasons)} for _, item, reasons in results[:limit]]

    def _find(self, document_id):
        item = self.build()["documents"].get(str(document_id))
        if not item:
            raise ValueError("Document was not found")
        return item

    @staticmethod
    def parse_message_rows(rows, item):
        parsed, seen, current = [], set(), None
        pattern = re.compile(r"^(\d{4}-\d{2}-\d{2}T[^ ]+)\s+—\s+([^:]+):\s*(.*)$")
        for _, block in sorted(rows, key=lambda row: row[0]):
            for line in str(block).splitlines():
                match = pattern.match(line)
                if match:
                    speaker = match.group(2).strip()
                    if re.fullmatch(r"Contact\s+[0-9a-f]{8}", speaker, re.I) or re.search(r"(?:\+?\d[\s().\-\u2011]*){7,}", speaker):
                        speaker = item["title"] if item["title"] != "Unknown contact" else "Other person"
                    current = {"time": match.group(1), "speaker": speaker, "text": match.group(3).strip()}
                    key = (current["time"], current["speaker"], current["text"])
                    if key not in seen:
                        parsed.append(current)
                        seen.add(key)
                elif current and line.strip():
                    current["text"] += "\n" + line.strip()
        return sorted(parsed, key=lambda message: message["time"])

    def document(self, document_id):
        item = self._find(document_id)
        result = self.public_item(item)
        result["related"] = self.related(document_id)
        if item["virtual"]:
            rows = []
            with sqlite3.connect(self.index_path()) as con:
                for path in item["paths"]:
                    rows.extend(con.execute(
                        "SELECT id,text FROM chunks WHERE path=? AND title=? ORDER BY id DESC LIMIT 100",
                        (path, item["raw_title"]),
                    ).fetchall())
            messages = self.parse_message_rows(rows, item)
            result.update({"messages": messages[-700:], "passages": item["chunks"]})
        else:
            result["excerpt"] = item["excerpt"][:5000]
        return result

    def summary_context(self, item_type, identifier, character_limit=18000):
        if item_type == "document":
            document = self.document(identifier)
            if document.get("messages"):
                return document["title"], "\n".join(f"{m['time']} — {m['speaker']}: {m['text']}" for m in document["messages"][-250:])[-character_limit:]
            return document["title"], document.get("excerpt", "")[:character_limit]
        files = self.build()["files"].get(identifier, [])[:30]
        context = "\n".join(f"- {item['title']} [{item['subtopic']}]: {item['excerpt'][:350]}" for item in files)
        return identifier, context[:character_limit]

    def get_summary(self, item_type, identifier):
        with self._state() as con:
            row = con.execute("SELECT summary,updated_at FROM summaries WHERE item_key=?", (f"{item_type}:{identifier}",)).fetchone()
        return dict(row) if row else None

    def save_summary(self, item_type, identifier, summary):
        with self._state() as con:
            con.execute(
                "INSERT INTO summaries(item_key,summary,updated_at) VALUES(?,?,?) "
                "ON CONFLICT(item_key) DO UPDATE SET summary=excluded.summary,updated_at=excluded.updated_at",
                (f"{item_type}:{identifier}", str(summary).strip(), utc_now()),
            )
        self._cache = None

    def save_alias(self, document_id, name):
        item = self._find(document_id)
        if not item["virtual"]:
            raise ValueError("Only conversations can be renamed")
        name = re.sub(r"\s+", " ", str(name)).strip()
        if not 1 <= len(name) <= 80 or re.search(r"(?:\+?\d[\s().\-\u2011]*){7,}", name):
            raise ValueError("Enter a contact or group name, not a phone number")
        with self._state() as con:
            con.execute(
                "INSERT INTO contact_aliases(document_id,name,updated_at) VALUES(?,?,?) "
                "ON CONFLICT(document_id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at",
                (document_id, name, utc_now()),
            )
        self._cache = None
        return name

    def export_state(self, destination):
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with self._state() as con:
            con.execute("PRAGMA wal_checkpoint(FULL)")
        shutil.copy2(self.state_path, destination)
        destination.chmod(0o600)
        return {"path": str(destination), "schemaVersion": self.schema_version}

    def merge_state(self, source):
        source = Path(source)
        if not source.is_file():
            raise ValueError("Portable graph state file was not found")
        try:
            with sqlite3.connect(source) as imported:
                imported.row_factory = sqlite3.Row
                if imported.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise ValueError("Portable graph state is damaged")
                aliases = imported.execute("SELECT document_id,name,updated_at FROM contact_aliases").fetchall()
                summaries = imported.execute("SELECT item_key,summary,updated_at FROM summaries").fetchall()
        except sqlite3.Error as exc:
            raise ValueError("This is not a compatible Vashisht knowledge graph file") from exc
        with self._state() as con:
            con.executemany(
                "INSERT INTO contact_aliases VALUES(?,?,?) ON CONFLICT(document_id) DO UPDATE SET "
                "name=excluded.name,updated_at=excluded.updated_at WHERE excluded.updated_at>contact_aliases.updated_at",
                [tuple(row) for row in aliases],
            )
            con.executemany(
                "INSERT INTO summaries VALUES(?,?,?) ON CONFLICT(item_key) DO UPDATE SET "
                "summary=excluded.summary,updated_at=excluded.updated_at WHERE excluded.updated_at>summaries.updated_at",
                [tuple(row) for row in summaries],
            )
        self._cache = None
        return {"aliases": len(aliases), "summaries": len(summaries)}

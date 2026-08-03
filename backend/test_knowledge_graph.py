from array import array
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from knowledge_graph import LocalKnowledgeGraph


class KnowledgeGraphTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.index = self.root / "index.sqlite"
        self.state = self.root / "graph.sqlite"
        self.config = self.root / "config.json"
        self.config.write_text(json.dumps({"index_path": str(self.index)}))
        with sqlite3.connect(self.index) as con:
            con.execute("CREATE TABLE chunks(id INTEGER PRIMARY KEY,path TEXT,locator TEXT,title TEXT,text TEXT,embedding BLOB)")
        self.graph = LocalKnowledgeGraph(self.config, self.state)

    def tearDown(self):
        self.temporary.cleanup()

    def add_chunk(self, path, title, text, vector=(1.0, 0.0)):
        path = self.root / path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        with sqlite3.connect(self.index) as con:
            con.execute(
                "INSERT INTO chunks(path,locator,title,text,embedding) VALUES(?,?,?,?,?)",
                (str(path), "1", title, text, array("f", vector).tobytes()),
            )

    def test_categories_dedup_search_and_relationship_explanation(self):
        repeated = "Azure computer vision study material " * 8
        self.add_chunk("study/ai-102.txt", "AI-102 Vision", repeated, (1.0, 0.0))
        self.add_chunk("downloads/ai-102-copy.txt", "AI-102 Vision Copy", repeated, (1.0, 0.0))
        self.add_chunk("study/azure-language.txt", "Azure Language", "Azure language AI exam preparation " * 8, (.96, .04))
        overview = self.graph.overview()
        self.assertEqual(overview["duplicatesMerged"], 1)
        self.assertEqual(len(self.graph.search("Azure language")), 2)
        topic = self.graph.topic_files("Study & Certifications")
        self.assertEqual(topic["total"], 2)
        document = self.graph.document(topic["files"][0]["id"])
        self.assertTrue(document["related"])
        self.assertIn("local embedding similarity", document["related"][0]["relationship"])
        self.assertEqual(document["duplicates"], 1)

    def test_conversation_is_readable_and_alias_is_portable(self):
        text = "2026-07-01T10:00:00+00:00 — Vashisht: Em chesthunnav\n2026-07-01T10:01:00+00:00 — Contact 1a2b3c4d: Tinnava"
        self.add_chunk("whatsapp/chat.jsonl", "WhatsApp with +1 (555) 555-0123", text)
        item = self.graph.topic_files("WhatsApp Conversations")["files"][0]
        self.assertNotIn("555", item["title"])
        self.graph.save_alias(item["id"], "Alex")
        document = self.graph.document(item["id"])
        self.assertEqual(document["title"], "Alex")
        self.assertEqual(document["messages"][1]["speaker"], "Alex")
        portable = self.root / "portable.vashishtgraph"
        self.graph.export_state(portable)
        second = LocalKnowledgeGraph(self.config, self.root / "second.sqlite")
        merged = second.merge_state(portable)
        self.assertEqual(merged["aliases"], 1)
        self.assertEqual(second.topic_files("WhatsApp Conversations")["files"][0]["title"], "Alex")

    def test_rejects_incompatible_portable_state(self):
        invalid = self.root / "invalid.vashishtgraph"
        invalid.write_text("not sqlite")
        with self.assertRaises(ValueError):
            self.graph.merge_state(invalid)

    def test_document_identity_survives_a_different_macos_account_name(self):
        first = LocalKnowledgeGraph.document_id("Documents & Downloads", "/Users/olduser/SecondBrainData/file.pdf", "File")
        second = LocalKnowledgeGraph.document_id("Documents & Downloads", "/Users/newuser/SecondBrainData/file.pdf", "File")
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()

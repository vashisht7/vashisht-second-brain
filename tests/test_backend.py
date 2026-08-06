import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock


SERVER = Path(__file__).parents[1] / "backend" / "server.py"
SPEC = importlib.util.spec_from_file_location("vashisht_backend", SERVER)
backend = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backend)


class PrivacyBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.originals = {
            name: getattr(backend, name)
            for name in ("retrieve", "pii_lookup", "web_search", "local_chat", "audit")
        }
        backend.retrieve = lambda _: []
        backend.web_search = lambda _: []
        backend.local_chat = lambda *_: "local response"
        backend.audit = lambda *args: None

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(backend, name, value)

    def test_shared_profiles_cannot_open_private_vault(self):
        def forbidden(_):
            raise AssertionError("private vault was queried")

        backend.pii_lookup = forbidden
        result = backend.chat({
            "message": "what is my license number",
            "audience": "charvi",
            "toggles": {"privateVault": True, "privateSession": True},
        })
        self.assertFalse(result["toggles"]["privateVault"])

    def test_self_profile_routes_protected_question_automatically(self):
        looked_up = []
        backend.pii_lookup = lambda query: looked_up.append(query) or []
        result = backend.chat({
            "message": "when does my I-94 expire?",
            "audience": "self",
            "toggles": {"privateSession": True, "webSearch": True},
        })
        self.assertEqual(looked_up, ["when does my I-94 expire?"])
        self.assertTrue(result["toggles"]["privateVault"])
        self.assertFalse(result["toggles"]["webSearch"])
        self.assertFalse(result["toggles"]["personalKnowledge"])

    def test_private_session_is_not_persisted(self):
        backend.pii_lookup = lambda _: []
        with tempfile.TemporaryDirectory() as folder:
            old_runtime, old_database, old_audit = backend.RUNTIME, backend.DATABASE, backend.AUDIT
            backend.RUNTIME = Path(folder)
            backend.DATABASE = Path(folder) / "conversations.sqlite"
            backend.AUDIT = Path(folder) / "permissions.log"
            try:
                result = backend.chat({
                    "message": "do not save",
                    "audience": "self",
                    "toggles": {"privateSession": True},
                })
                self.assertIsNone(result["conversationId"])
                self.assertFalse(backend.DATABASE.exists())
            finally:
                backend.RUNTIME, backend.DATABASE, backend.AUDIT = old_runtime, old_database, old_audit

    def test_switching_to_shared_profile_starts_clean_history(self):
        backend.pii_lookup = lambda _: []
        captured = []
        backend.local_chat = lambda messages, *_: captured.extend(messages) or "shared response"
        with tempfile.TemporaryDirectory() as folder:
            old_runtime, old_database, old_audit = backend.RUNTIME, backend.DATABASE, backend.AUDIT
            backend.RUNTIME = Path(folder)
            backend.DATABASE = Path(folder) / "conversations.sqlite"
            backend.AUDIT = Path(folder) / "permissions.log"
            try:
                private_id = backend.create_conversation("Private", "self")
                backend.save_message(private_id, "user", "private-history-marker")
                result = backend.chat({
                    "message": "hello friend",
                    "conversationId": private_id,
                    "audience": "friend",
                    "toggles": {"personalKnowledge": False},
                })
                self.assertNotEqual(result["conversationId"], private_id)
                self.assertFalse(any("private-history-marker" in message["content"] for message in captured))
            finally:
                backend.RUNTIME, backend.DATABASE, backend.AUDIT = old_runtime, old_database, old_audit

    def test_full_identifier_requires_explicit_reveal_language(self):
        with mock.patch.object(backend.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = "[]"
            backend.pii_lookup("show the full license number")
            self.assertIn("--reveal", run.call_args.args[0])

            backend.pii_lookup("what is my license number")
            self.assertNotIn("--reveal", run.call_args.args[0])

    def test_private_router_ignores_regular_personal_knowledge_questions(self):
        self.assertFalse(backend.should_use_private_vault("What projects have I worked on?"))
        self.assertTrue(backend.should_use_private_vault("What is my passport number?"))

    def test_web_failure_does_not_break_local_answer(self):
        backend.pii_lookup = lambda _: []
        backend.web_search = lambda _: (_ for _ in ()).throw(RuntimeError("provider unavailable"))
        result = backend.chat({
            "message": "What is new in AI?",
            "audience": "self",
            "toggles": {"privateSession": True, "webSearch": True, "personalKnowledge": False},
        })
        self.assertEqual(result["message"], "local response")
        self.assertTrue(result["toggles"]["webSearch"])

    def test_automatic_router(self):
        self.assertEqual(backend.route_question("What did Charvi say about the flight?")["id"], "local")
        self.assertEqual(backend.route_question("What do you know about me?")["id"], "local")
        self.assertEqual(backend.route_question("What is the latest Swift version?")["id"], "web")
        self.assertEqual(backend.route_question("Write a Python function to sort these values")["id"], "model")
        self.assertEqual(backend.route_question("Compare my project with the latest Swift release")["id"], "both")


if __name__ == "__main__":
    unittest.main()

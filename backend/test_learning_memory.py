import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SERVER_PATH = Path(__file__).with_name("server.py")
SPEC = importlib.util.spec_from_file_location("brain_server", SERVER_PATH)
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)


class LearningMemoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        SERVER.RUNTIME = Path(self.temporary.name)
        SERVER.DATABASE = SERVER.RUNTIME / "test.sqlite"
        SERVER.AUDIT = SERVER.RUNTIME / "audit.log"

    def tearDown(self):
        self.temporary.cleanup()

    def test_missing_answer_followup_becomes_searchable_memory(self):
        conversation = SERVER.create_conversation("Test")
        SERVER.set_pending_learning(conversation, "Which color did I choose for the sample room?")
        learned = SERVER.learn_pending_answer(conversation, "I chose deep green.")
        self.assertFalse(learned["protected"])
        matches = SERVER.learned_memory_matches("What color did I choose for the sample room?")
        self.assertEqual(matches[0]["answer"], "I chose deep green.")

    def test_protected_followup_never_enters_ordinary_memory(self):
        conversation = SERVER.create_conversation("Protected")
        SERVER.set_pending_learning(conversation, "What is my passport number?")
        learned = SERVER.learn_pending_answer(conversation, "It is an example value.")
        self.assertTrue(learned["protected"])
        self.assertEqual(SERVER.learned_memory_matches("passport number"), [])

    def test_explicit_remember_is_immediately_searchable(self):
        SERVER.remember_statement("My preferred sample color is deep green.")
        matches = SERVER.learned_memory_matches("preferred sample color")
        self.assertEqual(matches[0]["answer"], "My preferred sample color is deep green.")

    def test_training_queue_rejects_protected_content(self):
        with self.assertRaises(ValueError):
            SERVER.queue_training_example("My passport number is EXAMPLE123.")

    def test_style_correction_is_immediately_retrievable(self):
        old_feedback = SERVER.TRAINING_FEEDBACK
        SERVER.TRAINING_FEEDBACK = SERVER.RUNTIME / "feedback.jsonl"
        try:
            result = SERVER.save_style_correction(
                "Are you coming this weekend?", "Yes, I will come this weekend.",
                "Ha vasta le ee weekend", "charvi",
            )
            self.assertTrue(result["saved"])
            matches = SERVER.style_correction_matches("Will you come this weekend?", "charvi")
            self.assertEqual(matches[0]["corrected_response"], "Ha vasta le ee weekend")
            self.assertEqual(SERVER.style_correction_matches("Will you come this weekend?", "friend"), [])
        finally:
            SERVER.TRAINING_FEEDBACK = old_feedback

    def test_style_correction_rejects_protected_content(self):
        with self.assertRaises(ValueError):
            SERVER.save_style_correction(
                "What is my passport number?", "I do not know.", "It is EXAMPLE123.", "self"
            )

    def test_telugu_english_interview_updates_local_grammar_examples(self):
        old_feedback = SERVER.TRAINING_FEEDBACK
        SERVER.TRAINING_FEEDBACK = SERVER.RUNTIME / "language-feedback.jsonl"
        try:
            progress = SERVER.save_language_sample("future_later", "Tarvatha chesta le ippudu busy ga unna")
            self.assertEqual(progress["answered"], 1)
            examples = SERVER.language_grammar_examples()
            self.assertEqual(examples[0]["response"], "Tarvatha chesta le ippudu busy ga unna")
            self.assertTrue(SERVER.TRAINING_FEEDBACK.exists())
        finally:
            SERVER.TRAINING_FEEDBACK = old_feedback

    def test_telugu_english_interview_preserves_alternatives_as_variants(self):
        old_feedback = SERVER.TRAINING_FEEDBACK
        SERVER.TRAINING_FEEDBACK = SERVER.RUNTIME / "variant-feedback.jsonl"
        try:
            SERVER.save_language_sample("present_what", "Em chesthunnav (or) Enna Panra")
            examples = SERVER.language_grammar_examples()
            self.assertEqual(examples[0]["response"], "Em chesthunnav")
            records = [json.loads(line) for line in SERVER.TRAINING_FEEDBACK.read_text().splitlines()]
            self.assertEqual([item["messages"][1]["content"] for item in records], ["Em chesthunnav", "Enna Panra"])
        finally:
            SERVER.TRAINING_FEEDBACK = old_feedback

    def test_telugu_english_interview_rejects_protected_answer(self):
        with self.assertRaises(ValueError):
            SERVER.save_language_sample("future_later", "My passport number is EXAMPLE123")


if __name__ == "__main__":
    unittest.main()

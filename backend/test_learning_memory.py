import importlib.util
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


if __name__ == "__main__":
    unittest.main()

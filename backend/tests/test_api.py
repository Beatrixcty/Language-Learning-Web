import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("GROQ_API_KEY", "test-key-not-used")

import main  # noqa: E402


class BeaLingoApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(main.app)

    def test_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "mode": "local"})

    def test_default_model_is_current(self):
        self.assertNotEqual(main.groq_model, "llama-3.1-8b-instant")

    def test_local_vite_port_is_allowed_by_cors(self):
        origin = "http://127.0.0.1:5175"
        response = self.client.options(
            "/api/vocab-list",
            headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], origin)

    def test_remote_origin_is_not_allowed_by_cors(self):
        response = self.client.options(
            "/api/vocab-list",
            headers={"Origin": "https://example.com", "Access-Control-Request-Method": "POST"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("access-control-allow-origin", response.headers)

    def test_vocab_list_returns_supported_language(self):
        response = self.client.post("/api/vocab-list", json={"targetLanguage": "Spanish"})
        self.assertEqual(response.status_code, 200)
        words = response.json()["words"]
        self.assertGreaterEqual(len(words), 5)
        self.assertTrue(all("word" in item and "translation" in item for item in words))

    def test_portuguese_vocab_preserves_diacritics(self):
        response = self.client.post(
            "/api/vocab-list",
            json={"targetLanguage": "Portuguese · European Portuguese"},
        )
        words = {item["word"] for item in response.json()["words"]}
        self.assertIn("olá", words)
        self.assertIn("água", words)
        self.assertIn("consequência", words)
        self.assertIn("sustentável", words)

    def test_simplified_chinese_vocab_uses_simplified_script(self):
        response = self.client.post(
            "/api/vocab-list",
            json={"targetLanguage": "Chinese · Simplified Chinese · Mainland China"},
        )
        words = {item["word"] for item in response.json()["words"]}
        self.assertIn("谢谢", words)
        self.assertIn("餐厅", words)
        self.assertNotIn("謝謝", words)

    def test_variant_instruction_respects_region(self):
        instruction = main.get_variant_instruction({
            "language": "Chinese",
            "languageVariant": "Traditional Chinese",
            "languageRegion": "Hong Kong",
        })
        self.assertIn("Hong Kong", instruction)
        self.assertIn("Traditional Chinese", instruction)

    def test_focus_vocabulary_normalizes_part_of_speech(self):
        items = main._normalize_focus_vocab([
            {"front": "viajar", "back": "to travel", "partOfSpeech": "verbs"},
            {"front": "bom dia", "back": "good morning", "partOfSpeech": "noun"},
            {"front": "olá", "back": "hello", "partOfSpeech": "made-up-label"},
        ])
        self.assertEqual([item["partOfSpeech"] for item in items], ["verb", "noun", "noun"])

    def test_lesson_schema_requires_part_of_speech(self):
        vocab_schema = main.SENTENCE_LESSON_SCHEMA["properties"]["vocabulary"]["items"]
        self.assertIn("partOfSpeech", vocab_schema["required"])
        self.assertEqual(vocab_schema["properties"]["partOfSpeech"]["enum"], list(main.PARTS_OF_SPEECH))

    def test_flashcard_lessons_use_ai_generation_pipeline(self):
        draft = {
            "flashcards": [{
                "front": "viajar",
                "back": "to travel",
                "note": "Common infinitive",
                "exampleTarget": "Gosto de viajar.",
                "exampleSource": "I like to travel.",
                "partOfSpeech": "verb",
            }],
            "practice": [{
                "prompt": "What does viajar mean?",
                "options": ["to travel", "to eat", "to read", "to sleep"],
                "answer": "to travel",
                "type": "multiple_choice",
                "explanation": "Viajar means to travel.",
            }] * 3,
        }
        with patch.object(main, "_generate_validated_json", return_value=draft) as generate, patch.object(
            main, "_review_lesson_quality", return_value=draft
        ) as review:
            response = self.client.post("/api/generate-lesson", json={
                "profile": {"language": "Portuguese", "level": "Beginner"},
                "style": "flashcards",
                "count": 5,
            })
        self.assertEqual(response.status_code, 200)
        self.assertTrue(generate.called)
        self.assertTrue(review.called)
        self.assertEqual(generate.call_args.kwargs["response_schema"], main.FLASHCARD_LESSON_SCHEMA)

    def test_demo_mode_never_reads_chatgpt_credentials(self):
        with patch.object(main, "BEALINGO_MODE", "demo"), patch.object(
            main, "_read_private_json"
        ) as read_credentials:
            self.assertIsNone(main._chatgpt_credentials())
        read_credentials.assert_not_called()

    def test_deployed_mode_requires_proxy_secret(self):
        with patch.object(main, "BEALINGO_MODE", "personal"), patch.object(
            main, "PRIVATE_PROXY_SECRET", "expected-secret"
        ):
            unauthorized = self.client.post(
                "/api/vocab-list",
                json={"targetLanguage": "Portuguese"},
            )
            authorized = self.client.post(
                "/api/vocab-list",
                json={"targetLanguage": "Portuguese"},
                headers={"x-bealingo-proxy-secret": "expected-secret"},
            )
        self.assertEqual(unauthorized.status_code, 401)
        self.assertEqual(authorized.status_code, 200)

    def test_demo_rate_limit_blocks_ai_before_provider_call(self):
        main.demo_rate_counts.clear()
        with patch.object(main, "BEALINGO_MODE", "demo"), patch.object(
            main, "PRIVATE_PROXY_SECRET", "expected-secret"
        ), patch.dict(main.DEMO_RATE_LIMITS, {"/api/generate-lesson": 0}):
            response = self.client.post(
                "/api/generate-lesson",
                headers={
                    "x-bealingo-proxy-secret": "expected-secret",
                    "x-bealingo-client-ip": "203.0.113.10",
                },
                json={
                    "profile": {"language": "Portuguese", "level": "Beginner"},
                    "style": "flashcards",
                    "count": 3,
                },
            )
        self.assertEqual(response.status_code, 429)
        self.assertIn("daily AI limit", response.json()["error"])


if __name__ == "__main__":
    unittest.main()

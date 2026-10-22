"""Regressions for the private Studio AI bridge (no network or real credentials)."""
import importlib.util
import json
import os
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

FILE = Path(__file__).resolve().parents[1] / "vps" / "central_api.py"
SPEC = importlib.util.spec_from_file_location("horizon_central_ai_test", FILE)
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, _limit):
        return self.payload


class AiBridgeTests(unittest.TestCase):
    def test_uses_groq_without_copying_key_to_output(self):
        seen = []

        def reply(request, timeout):
            seen.append(request)
            return FakeResponse({"choices": [{"message": {"content": "Funcionando!"}}],
                                 "usage": {"prompt_tokens": 15, "completion_tokens": 4, "total_tokens": 19}})

        with patch.dict(os.environ, {"GROQ_API_KEY": "fake-groq-key", "GEMINI_API_KEY": ""}), \
             patch.object(bridge.urllib.request, "urlopen", reply):
            result = bridge.complete_ai("Explique o status da fila")
        self.assertEqual(result["provider"], "groq")
        self.assertEqual(result["response"], "Funcionando!")
        self.assertEqual(result["usage"]["total_tokens"], 19)
        self.assertNotIn("fake-groq-key", json.dumps(result))
        self.assertEqual(len(seen), 1)

    def test_falls_back_to_gemini_if_groq_fails(self):
        calls = []

        def reply(request, timeout):
            calls.append(request.full_url)
            if "api.groq.com" in request.full_url:
                raise urllib.error.HTTPError(request.full_url, 429, "quota", None, None)
            return FakeResponse({"candidates": [{"content": {"parts": [{"text": "Gemini operacional"}]}}],
                                 "usageMetadata": {"promptTokenCount": 11, "candidatesTokenCount": 3,
                                                   "totalTokenCount": 14}})

        with patch.dict(os.environ, {"GROQ_API_KEY": "fake-groq-key",
                                     "GEMINI_API_KEY": "fake-gemini-key",
                                     "GEMINI_MODEL": "gemini-2.5-flash",
                                     "GEMINI_REQUESTS_ENABLED": "true"}), \
             patch.object(bridge.urllib.request, "urlopen", reply):
            result = bridge.complete_ai("Consulte a situação atual")
        self.assertEqual(result["provider"], "gemini")
        self.assertEqual(result["model"], "gemini-3.6-flash")
        self.assertEqual(result["response"], "Gemini operacional")
        self.assertEqual(result["usage"]["total_tokens"], 14)
        self.assertEqual(len(calls), 2)
        self.assertNotIn("fake-gemini-key", json.dumps(result))

    def test_no_credentials_returns_controlled_error(self):
        with patch.dict(os.environ, {"GROQ_API_KEY": "", "API_IA_GROQ": "", "GEMINI_API_KEY": ""}):
            with self.assertRaisesRegex(RuntimeError, "provedor_ia_nao_configurado"):
                bridge.complete_ai("Consulta válida")


if __name__ == "__main__":
    unittest.main()

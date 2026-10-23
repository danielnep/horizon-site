"""Four-stage routed AI for Orbit dashboard, without real network or credentials."""
import importlib.util
import json
import os
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

FILE = Path(__file__).resolve().parents[1] / "vps" / "central_api.py"
SPEC = importlib.util.spec_from_file_location("horizon_control_ai_test", FILE)
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)

MODELS = ["gemini-3.6-flash", "openai/gpt-oss-120b",
          "gemma-4-31b-it", "qwen/qwen3.8-27b"]
KEYS = {"GROQ_API_KEY": "fake-test-groq-key", "GEMINI_API_KEY": "fake-test-google-key",
        "GEMINI_REQUESTS_ENABLED": "true", "HORIZON_CONTROL_AI_MODEL": "",
        "HORIZON_CONTROL_GEMINI_MODEL": ""}

class FakeResponse:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, _size):
        return self.body


def identity(request):
    if "api.groq.com" in request.full_url:
        return json.loads(request.data)["model"]
    return request.full_url.split("/models/")[1].split(":generateContent")[0]


def good(model):
    if model.startswith("gemini") or model.startswith("gemma"):
        return FakeResponse({"candidates": [{"content": {"parts": [{"text": "Resposta real"}]}}],
                             "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 4,
                                               "totalTokenCount": 14}})
    return FakeResponse({"choices": [{"message": {"content": "Resposta real"}}],
                         "usage": {"prompt_tokens": 10, "completion_tokens": 4,
                                   "total_tokens": 14}})


class AiBridgeTests(unittest.TestCase):
    def test_four_ordered_models_and_two_keys(self):
        with patch.dict(os.environ, KEYS):
            routes = bridge._control_ai_routes("Responda.")
        self.assertEqual([model for _, model, *_ in routes], MODELS)
        self.assertEqual([provider for provider, *_ in routes],
                         ["gemini", "groq", "gemini", "groq"])
        for provider, model, _url, headers, body in routes:
            self.assertEqual(headers["x-goog-api-key"] if provider == "gemini"
                             else headers["Authorization"], "fake-test-google-key" if provider == "gemini"
                             else "Bearer fake-test-groq-key")
            if model == "gemma-4-31b-it":
                self.assertNotIn("thinkingConfig", body["generationConfig"])

    def test_primary_gemini_succeeds_without_unneeded_fallback(self):
        seen = []
        def reply(request, timeout):
            seen.append(identity(request))
            return good(seen[-1])
        with patch.dict(os.environ, KEYS), patch.object(bridge.urllib.request, "urlopen", reply):
            result = bridge.complete_ai("Consulte a situação atual")
        self.assertEqual(result["model"], MODELS[0])
        self.assertEqual(seen, MODELS[:1])
        self.assertEqual(result["usage"]["total_tokens"], 14)

    def test_groq_120b_after_gemini_rate_limit(self):
        seen = []
        def reply(request, timeout):
            name=identity(request)
            seen.append(name)
            if name == MODELS[0]:
                raise urllib.error.HTTPError(request.full_url, 429, "quota", None, None)
            return good(name)
        with patch.dict(os.environ, KEYS), patch.object(bridge.urllib.request, "urlopen", reply):
            result = bridge.complete_ai("Consulte a situação atual")
        self.assertEqual(result["model"], MODELS[1])
        self.assertEqual(seen, MODELS[:2])

    def test_gemma_tried_after_gemini_quota_and_groq_denied(self):
        seen = []
        def reply(request, timeout):
            name=identity(request)
            seen.append(name)
            if len(seen)<3:
                raise urllib.error.HTTPError(request.full_url, 429 if name==MODELS[0] else 403,
                                             "blocked", None, None)
            return good(name)
        with patch.dict(os.environ, KEYS), patch.object(bridge.urllib.request, "urlopen", reply):
            result=bridge.complete_ai("Consulte a situação atual")
        self.assertEqual(result["model"], MODELS[2])
        self.assertEqual(seen, MODELS[:3])

    def test_qwen_after_three_failures_and_no_secret_in_answer(self):
        seen=[]
        def reply(request, timeout):
            name=identity(request)
            seen.append(name)
            if len(seen)<4:
                raise urllib.error.HTTPError(request.full_url, 429, "quota", None, None)
            return good(name)
        with patch.dict(os.environ, KEYS), patch.object(bridge.urllib.request, "urlopen", reply):
            result=bridge.complete_ai("Consulte a situação atual")
        self.assertEqual(result["model"], MODELS[3])
        self.assertEqual(seen, MODELS)
        self.assertNotIn("fake-test-google-key", json.dumps(result))
        self.assertNotIn("fake-test-groq-key", json.dumps(result))

    def test_failure_reports_all_models_without_secret(self):
        seen=[]
        def reply(request, timeout):
            name=identity(request)
            seen.append(name)
            raise urllib.error.HTTPError(request.full_url, 429 if "gem" in name else 403,
                                         "quota", None, None)
        with patch.dict(os.environ, KEYS), patch.object(bridge.urllib.request, "urlopen", reply):
            with self.assertRaises(RuntimeError) as captured:
                bridge.complete_ai("Consulta válida")
        error=str(captured.exception)
        self.assertEqual(seen, MODELS)
        self.assertTrue(all(model in error for model in MODELS))
        self.assertNotIn("fake-test",error)

    def test_missing_google_routes_only_available_groq_models(self):
        config={**KEYS, "GEMINI_API_KEY": ""}
        with patch.dict(os.environ, config):
            routes=bridge._control_ai_routes("Responder OK")
        self.assertEqual([r[1] for r in routes], [MODELS[1], MODELS[3]])

    def test_no_credentials_returns_controlled_error(self):
        with patch.dict(os.environ, {**KEYS, "GROQ_API_KEY": "", "API_IA_GROQ": "",
                                    "GEMINI_API_KEY": ""}):
            with self.assertRaisesRegex(RuntimeError, "provedor_ia_nao_configurado"):
                bridge.complete_ai("Consulta válida")

if __name__ == "__main__":
    unittest.main()

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from vps import central_api


class EfficiencyByTaskTests(unittest.TestCase):
    def test_real_task_usage_and_unattributed_history_are_distinct(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ("usage-" + dt.datetime.now(dt.timezone.utc).date().isoformat() + ".jsonl")
            rows = [
                {"at": "2026-10-22T00:00:00Z", "taskId": "work-123", "agent": "backend-engineer",
                 "provider": "gemini", "model": "gemini-3.6-flash", "input": 60, "output": 20, "total": 95},
                {"at": "2026-10-22T00:00:01Z", "taskId": "work-123", "agent": "backend-engineer",
                 "provider": "gemini", "model": "gemma-4-31b-it", "input": 40, "output": 30, "total": 70},
                {"at": "2026-10-22T00:00:02Z", "agent": "backend-engineer", "provider": "groq",
                 "model": "openai/gpt-oss-120b", "input": 10, "output": 5, "total": 15},
            ]
            path.write_text("".join(json.dumps(x) + "\n" for x in rows))
            with patch.object(central_api, "TELEMETRY", Path(directory)):
                usage, _, _ = central_api.activity_data(1)
            self.assertEqual(usage["total"], 180)
            self.assertEqual(usage["byTask"]["work-123"]["total"], 165)
            self.assertEqual(usage["byTask"]["work-123"]["calls"], 2)
            self.assertEqual(usage["byTask"]["work-123"]["byModel"]["gemma-4-31b-it"], 70)
            self.assertEqual(usage["unattributed"]["total"], 15)


if __name__ == "__main__":
    unittest.main()

"""Read-only regression tests for the small SQLite observer process."""
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

OBSERVER = Path(__file__).resolve().parents[1] / "maestro" / "operational-state.py"


class OperationalObserverTests(unittest.TestCase):
    def test_reports_only_aggregate_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            dbfile = Path(directory) / "state.sqlite3"
            with sqlite3.connect(dbfile) as db:
                db.execute("CREATE TABLE tasks (status TEXT, secret TEXT)")
                db.execute("CREATE TABLE events (kind TEXT, created_at REAL)")
                db.executemany("INSERT INTO tasks VALUES (?,?)", [
                    ("queued", "private-user-message"),
                    ("succeeded", "private-customer-record"),
                ])
                db.executemany("INSERT INTO events VALUES (?,?)", [
                    ("enqueued", 1792475000),
                    ("succeeded", 1792475500),
                ])
            observed = subprocess.run(
                [sys.executable, "-I", str(OBSERVER)],
                input=dbfile.read_bytes(), capture_output=True, check=False, timeout=10,
            )
            self.assertEqual(observed.returncode, 0)
            result = json.loads(observed.stdout)
            self.assertEqual(result["schema"], 1)
            self.assertEqual(result["task_count"], 2)
            self.assertEqual(result["task_counts"]["queued"], 1)
            self.assertEqual(result["task_counts"]["succeeded"], 1)
            self.assertTrue(result["last_success_event_at"].endswith("Z"))
            self.assertNotIn(b"private", observed.stdout)
            self.assertFalse(observed.stderr)

    def test_rejects_non_sqlite_without_exposing_input(self):
        result = subprocess.run(
            [sys.executable, "-I", str(OBSERVER)],
            input=b"secret-token should never be logged",
            capture_output=True, check=False, timeout=10,
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr, b"")


if __name__ == "__main__":
    unittest.main()

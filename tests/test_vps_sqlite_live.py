"""Event-driven SQLite notifications on Linux; no production database is touched."""
import importlib.util
import sqlite3
import tempfile
import threading
import time
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1] / "vps" / "central_api.py"
spec = importlib.util.spec_from_file_location("horizon_vps_control_live_test", MODULE)
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)


class SqliteLiveEventsTest(unittest.TestCase):
    def test_worker_commit_pushes_signal_without_database_polling(self):
        with tempfile.TemporaryDirectory() as tmp:
            dbfile = Path(tmp) / "active.sqlite3"
            with sqlite3.connect(dbfile) as db:
                db.execute("PRAGMA journal_mode=WAL")
                db.execute("CREATE TABLE fake_tasks (id INTEGER)")
            original = live.DB
            live.DB = dbfile
            ready = threading.Event()
            received = []

            def listener():
                stream = live.listen_sqlite_changes()
                ready.set()
                try:
                    received.append(next(stream))
                finally:
                    stream.close()

            try:
                watch = threading.Thread(target=listener, daemon=True)
                watch.start()
                self.assertTrue(ready.wait(1))
                time.sleep(0.12)  # ensure the inotify watcher has been registered
                began = time.monotonic()
                with sqlite3.connect(dbfile) as db:
                    db.execute("INSERT INTO fake_tasks VALUES (1)")
                watch.join(timeout=3)
                self.assertEqual(received, [True])
                self.assertLess(time.monotonic() - began, 1.5)
            finally:
                live.DB = original


if __name__ == "__main__":
    unittest.main()

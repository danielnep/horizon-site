#!/usr/bin/env python3
"""Inspect an already-decrypted SQLite snapshot passed over stdin.

No network, credentials, GitHub writes or operational mutations. The caller
verifies GitHub blob integrity and Fernet HMAC before invoking this process.
Only bounded aggregate telemetry goes to stdout, never task or customer data.
"""
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone

MAX_DATABASE_BYTES = 64 * 1024 * 1024
STATUS = ("queued", "running", "succeeded", "failed", "blocked")


def timestamp(value):
    if value is None:
        return None
    return datetime.fromtimestamp(float(value), timezone.utc).isoformat().replace("+00:00", "Z")


def inspect_database(raw):
    if len(raw) > MAX_DATABASE_BYTES or not raw.startswith(b"SQLite format 3\x00"):
        raise ValueError("snapshot_invalid")
    with tempfile.TemporaryDirectory(prefix="horizon-observe-") as root:
        dbfile = Path(root) / "snapshot.sqlite3"
        dbfile.write_bytes(raw)
        with sqlite3.connect(dbfile.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
            db.execute("PRAGMA query_only=ON")
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise ValueError("integrity_invalid")
            counts = {status: 0 for status in STATUS}
            for status, number in db.execute("SELECT status, COUNT(*) FROM tasks GROUP BY status"):
                if status not in counts:
                    raise ValueError("status_invalid")
                counts[status] = int(number)
            total = db.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
            if total != sum(counts.values()):
                raise ValueError("count_mismatch")
            latest = db.execute("SELECT MAX(created_at) FROM events").fetchone()[0]
            success = db.execute(
                "SELECT MAX(created_at) FROM events WHERE kind='succeeded'"
            ).fetchone()[0]
            return {"schema": 1, "task_count": total, "task_counts": counts,
                    "last_event_at": timestamp(latest),
                    "last_success_event_at": timestamp(success)}


def main():
    raw = sys.stdin.buffer.read(MAX_DATABASE_BYTES + 1)
    if len(raw) > MAX_DATABASE_BYTES:
        return 2
    try:
        print(json.dumps(inspect_database(raw), sort_keys=True), flush=True)
        return 0
    except (ValueError, sqlite3.Error, OverflowError, OSError):
        # Never leak SQL fields, record values, paths or exception messages.
        return 2


if __name__ == "__main__":
    sys.exit(main())

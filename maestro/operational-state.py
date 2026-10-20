#!/usr/bin/env python3
"""Read-only, bounded operational telemetry from Railway's encrypted GitHub SQLite.

This observer NEVER writes to GitHub, the supervisor checkpoint, or the handoff
ledger. Only aggregate counts, Git blob SHA, and SQLite event timestamps leave
the process. Task texts, secrets, customer data and memory never enter stdout.
"""
import base64
import binascii
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen
import zlib

REPOSITORY = "danielnep/May-Maestro-Executor"
PATH = "runtime/state.sqlite3.gz"
BRANCH = re.compile(r"^agent-state/railway-[a-z0-9-]{2,36}$")
SHA = re.compile(r"^[a-f0-9]{40}$")
MAX_BLOB_BYTES = 12_000_000
MAX_DATABASE_BYTES = 64 * 1024 * 1024
STATUS = ("queued", "running", "succeeded", "failed", "blocked")


def derive_key(private_pem):
    from cryptography.fernet import Fernet
    material = base64.urlsafe_b64encode(
        hashlib.sha256(b"horizon-railway-key-v1:" + private_pem).digest()
    ).decode("ascii")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(
        ("horizon-github-sqlite-v1:" + material).encode("ascii")
    ).digest()))


def download_snapshot(token, branch, *, opener=urlopen):
    endpoint = ("https://api.github.com/repos/" + REPOSITORY
                + "/contents/" + PATH + "?ref=" + quote(branch, safe=""))
    request = Request(endpoint, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "Horizon-Operational-Observer/1",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with opener(request, timeout=15) as response:
            body = response.read(MAX_BLOB_BYTES * 2 + 1)
        if len(body) > MAX_BLOB_BYTES * 2:
            raise RuntimeError("github_response_oversized")
        obj = json.loads(body)
        if obj.get("encoding") != "base64" or not SHA.fullmatch(str(obj.get("sha"))):
            raise RuntimeError("github_blob_metadata_invalid")
        encrypted = base64.b64decode("".join(obj["content"].split()), validate=True)
        if not encrypted or len(encrypted) > MAX_BLOB_BYTES:
            raise RuntimeError("github_blob_size_invalid")
        # Check blob integrity before decryption, independently of the GitHub API.
        actual = hashlib.sha1(
            b"blob " + str(len(encrypted)).encode("ascii") + b"\\0" + encrypted
        ).hexdigest()
        if actual != obj["sha"]:
            raise RuntimeError("github_blob_sha_mismatch")
        return encrypted, actual
    except HTTPError as exc:
        raise RuntimeError("github_http_" + str(exc.code)) from None
    except (ValueError, TypeError, KeyError, binascii.Error):
        raise RuntimeError("github_snapshot_invalid") from None


def unpack_snapshot(encrypted, private_pem):
    from cryptography.fernet import InvalidToken
    try:
        compressed = derive_key(private_pem).decrypt(encrypted)
    except (InvalidToken, ValueError, TypeError):
        raise RuntimeError("snapshot_decryption_failed") from None
    # Bound gzip inflation; an encrypted but corrupted archive cannot exhaust RAM.
    try:
        inflater = zlib.decompressobj(16 + zlib.MAX_WBITS)
        raw = inflater.decompress(compressed, MAX_DATABASE_BYTES + 1)
        if (len(raw) > MAX_DATABASE_BYTES or not inflater.eof
                or inflater.unused_data or inflater.unconsumed_tail):
            raise RuntimeError("snapshot_uncompressed_size_invalid")
        raw += inflater.flush()
    except zlib.error:
        raise RuntimeError("snapshot_gzip_invalid") from None
    if len(raw) > MAX_DATABASE_BYTES or not raw.startswith(b"SQLite format 3\\x00"):
        raise RuntimeError("snapshot_sqlite_invalid")
    return raw


def timestamp(value):
    if value is None:
        return None
    return datetime.fromtimestamp(float(value), timezone.utc).isoformat().replace("+00:00", "Z")


def inspect_database(raw):
    with tempfile.TemporaryDirectory(prefix="horizon-observe-") as root:
        dbfile = Path(root) / "snapshot.sqlite3"
        dbfile.write_bytes(raw)
        with sqlite3.connect(dbfile.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
            db.execute("PRAGMA query_only=ON")
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("sqlite_integrity_invalid")
            counts = {name: 0 for name in STATUS}
            for name, number in db.execute("SELECT status, COUNT(*) FROM tasks GROUP BY status"):
                if name not in counts:
                    raise RuntimeError("sqlite_task_status_unknown")
                counts[name] = int(number)
            latest = db.execute("SELECT MAX(created_at) FROM events").fetchone()[0]
            success = db.execute(
                "SELECT MAX(created_at) FROM events WHERE kind='succeeded'"
            ).fetchone()[0]
            total = db.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
            if total != sum(counts.values()):
                raise RuntimeError("sqlite_task_count_mismatch")
            return {
                "task_count": total,
                "task_counts": counts,
                "last_event_at": timestamp(latest),
                "last_success_event_at": timestamp(success),
            }


def observe(env, *, opener=urlopen):
    if env.get("HORIZON_PY_AGENTS_ENABLED") != "1":
        raise RuntimeError("observer_disabled")
    branch = env.get("HORIZON_STATE_BRANCH", "")
    if not BRANCH.fullmatch(branch):
        raise RuntimeError("state_branch_invalid")
    token = env.get("GITHUB_TOKEN")
    private_path = (Path(env.get("RAILWAY_VOLUME_MOUNT_PATH", "/data"))
                    / "horizon-checkpoint-migration-private.pem")
    if not token or not private_path.is_file():
        raise RuntimeError("observer_credentials_unavailable")
    if private_path.stat().st_mode & 0o077:
        raise RuntimeError("observer_key_permissions_unsafe")
    encrypted, sha = download_snapshot(token, branch, opener=opener)
    details = inspect_database(unpack_snapshot(encrypted, private_path.read_bytes()))
    last = details["last_event_at"]
    age = None
    if last:
        age = int((datetime.now(timezone.utc)
                   - datetime.fromisoformat(last.replace("Z", "+00:00"))).total_seconds())
    return {
        "schema": 1,
        "status": "verified",
        "branch": branch,
        "snapshot_sha": sha,
        "event_age_seconds": max(age, 0) if age is not None else None,
        "event_recency": ("unknown" if age is None else "invalid_future"
                          if age < -300 else "stale" if age > 6 * 3600 else "recent"),
        **details,
    }


def main():
    try:
        print(json.dumps(observe(os.environ), sort_keys=True), flush=True)
    except Exception as exc:
        # Error categories only. NEVER include exception strings or remote content.
        known = (str(exc) if isinstance(exc, RuntimeError)
                 and re.fullmatch(r"[a-z0-9_]{3,80}|github_http_[0-9]{3}", str(exc))
                 else "observer_unavailable")
        print(json.dumps({"schema": 1, "status": "unavailable", "reason": known}), flush=True)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())

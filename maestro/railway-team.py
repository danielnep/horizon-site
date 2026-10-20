#!/usr/bin/env python3
"""Single-process, fail-closed host for the existing 17 Python specialists.

This is run INSIDE horizon-site, not as a new Railway service. It does not
migrate or rewrite checkpoint content: the existing encrypted GitHub SQLite
snapshot remains canonical until a separately approved migration. Only one
worker can own it, so GitHub Actions must be disabled first.
"""
import hashlib
import base64
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

REPO = "danielnep/May-Maestro-Executor"
SHA = re.compile(r"^[0-9a-f]{40}$")
WORKFLOWS = ("chat-requests.yml", "agent-executors.yml")
MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
MAX_EXPANDED_BYTES = 100 * 1024 * 1024
MIN_SCRATCH_FREE_BYTES = 350 * 1024 * 1024
SLEEP_SECONDS = 180
SESSION_SECONDS = 90
stop = False


def event(kind, **safe):
    """Log only declared machine metadata. No exception text or task payload."""
    allowed = {"count", "rc", "seconds", "sha", "reason", "required", "state"}
    packet = {k: v for k, v in safe.items() if k in allowed}
    print("[team-railway] " + kind + " " + json.dumps(packet, sort_keys=True), flush=True)


def shutdown(_signum, _frame):
    global stop
    stop = True


def workflow_state(repo, name, token, *, opener=urllib.request.urlopen):
    endpoint = ("https://api.github.com/repos/" + repo + "/actions/workflows/" + name)
    req = urllib.request.Request(endpoint, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "Horizon-Railway-Team/1",
    })
    with opener(req, timeout=15) as response:
        payload = json.load(response)
    if not isinstance(payload, dict) or payload.get("state") not in (
            "active", "disabled_manually", "disabled_inactivity", "deleted"):
        raise RuntimeError("workflow_state_unverified")
    return payload["state"]


def verify_exclusive(token, opener=urllib.request.urlopen):
    # This test is performed on each Railway process startup. A manual flag
    # alone is not proof that a competing GitHub Actions writer has stopped.
    for name in WORKFLOWS:
        state = workflow_state(REPO, name, token, opener=opener)
        if state == "active":
            raise RuntimeError("github_actions_still_active")
    return True


def verify_environment(env):
    # The new branch lives on GITHUB. No legacy Actions or Railway API tokens
    # are required to read it; one private key owned by Railway derives the
    # new stable Fernet password locally after a validated one-time rekey.
    mandatory=("GITHUB_TOKEN","KERNEL_API_KEY","HORIZON_EXECUTOR_SHA",
               "HORIZON_STATE_BRANCH")
    if any(not env.get(name) for name in mandatory):
        raise RuntimeError("missing_protected_credentials")
    if not SHA.fullmatch(env["HORIZON_EXECUTOR_SHA"]):
        raise RuntimeError("executor_commit_not_pinned")
    branch=env["HORIZON_STATE_BRANCH"]
    if not re.fullmatch(r"agent-state/railway-[a-z0-9-]{2,36}",branch):
        raise RuntimeError("railway_state_branch_invalid")
    if env.get("HORIZON_AGENT_ACTIONS_DISABLED")!="1":
        raise RuntimeError("single_writer_not_armed")
    if not (env.get("GEMINI_API_KEY") or env.get("DEEPSEEK_API_KEY")):
        raise RuntimeError("no_reasoning_provider")
    key_file=(Path(env.get("RAILWAY_VOLUME_MOUNT_PATH","/data"))
              /"horizon-checkpoint-migration-private.pem")
    if not key_file.is_file() or (key_file.stat().st_mode&0o077):
        raise RuntimeError("railway_state_private_key_missing_or_unsafe")
    material=base64.urlsafe_b64encode(hashlib.sha256(
        b"horizon-railway-key-v1:"+key_file.read_bytes()).digest()).decode()
    # This material never enters logs/GitHub/MCP/browser; only the trusted
    # child Python worker reads it as its environment variable.
    env["HORIZON_SQLITE_ENCRYPTION_KEY"]=material
    return env["HORIZON_EXECUTOR_SHA"]


def _safe_members(tar):
    total = 0
    root = None
    extracted = []
    for member in tar:
        name = PurePosixPath(member.name)
        if member.name.startswith("/") or ".." in name.parts or not name.parts:
            raise RuntimeError("invalid_source_archive")
        if root is None:
            root = name.parts[0]
        # GitHub archives include the top-level root folder as their first
        # tar entry; it is metadata, never a destination to extract.
        if len(name.parts) == 1 and member.isdir() and name.parts[0] == root:
            continue
        if len(name.parts) < 2 or name.parts[0] != root or not (
                member.isdir() or member.isfile()):
            raise RuntimeError("invalid_source_archive")
        total += max(0, member.size)
        if total > MAX_EXPANDED_BYTES or len(extracted) > 5000:
            raise RuntimeError("source_archive_too_large")
        if member.isfile():
            extracted.append((member, Path(*name.parts[1:])))
    return extracted


def fetch_source(sha, target, *, opener=urllib.request.urlopen):
    if not SHA.fullmatch(sha):
        raise RuntimeError("executor_commit_not_pinned")
    endpoint = "https://api.github.com/repos/" + REPO + "/tarball/" + sha
    req = urllib.request.Request(endpoint, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "Horizon-Railway-Team/1"
    })
    content = bytearray()
    with opener(req, timeout=45) as response:
        while True:
            chunk = response.read(1024 * 128)
            if not chunk:
                break
            content.extend(chunk)
            if len(content) > MAX_ARCHIVE_BYTES:
                raise RuntimeError("source_archive_too_large")
    if len(content) < 100:
        raise RuntimeError("source_archive_unavailable")
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as archive:
        members = _safe_members(archive)
        for member, rel in members:
            # Only regular files; disallow links and device nodes.
            destination = target / rel
            destination.parent.mkdir(parents=True, exist_ok=True)
            src = archive.extractfile(member)
            if src is None:
                raise RuntimeError("invalid_source_archive")
            with src, destination.open("wb") as dst:
                shutil.copyfileobj(src, dst)
    for relative in ("horizon_core/commit_bridge.py", "horizon_core/worker.py",
                     "horizon_core/direct_chat.py"):
        if not (target / relative).is_file():
            raise RuntimeError("source_archive_missing_runtime")
    return len(members)


def _dependency_ready():
    try:
        from cryptography.fernet import Fernet  # noqa: F401
        return True
    except ImportError:
        return False


def install_dependency(env, *, run=subprocess.run, target=None):
    if _dependency_ready():
        return ""
    target = target or Path(tempfile.gettempdir()) / "horizon-team-deps"
    target.mkdir(parents=True, exist_ok=True)
    # Reuse the exact dependency version tested by the current Actions workflow.
    result = run([sys.executable, "-m", "pip", "install",
                  "--disable-pip-version-check", "--no-input", "--quiet",
                  "--target", str(target), "cryptography==46.0.3"],
                 timeout=90, capture_output=True, text=True, check=False, env=env)
    if result.returncode:
        raise RuntimeError("python_dependency_unavailable")
    return str(target)


def _memory_cap():
    # One Python process, never one process per specialist.
    # Lower than the 0.5 GB Free RAM limit after trial.
    import resource
    limit = 350 * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (limit, limit))


def run_cycle(root, env, *, run=subprocess.run):
    if shutil.disk_usage(root).free < MIN_SCRATCH_FREE_BYTES:
        raise RuntimeError("scratch_storage_low")
    args = [sys.executable, "-m", "horizon_core.commit_bridge",
            "--root", str(root), "--session-seconds", str(SESSION_SECONDS)]
    # Never execute with a login shell or inject a key into arguments.
    result = run(args, cwd=root, env=env, capture_output=True, text=True,
                 check=False, timeout=SESSION_SECONDS + 65,
                 preexec_fn=_memory_cap if sys.platform.startswith("linux") else None)
    # Do NOT print arbitrary model output, task content or remote errors.
    event("cycle", rc=result.returncode, seconds=SESSION_SECONDS)
    return result.returncode


def main(environ=None):
    env = dict(os.environ if environ is None else environ)
    sha = verify_environment(env)
    # Both competing workflow writers must be disabled before any mutation.
    verify_exclusive(env["GITHUB_TOKEN"])
    if shutil.which("git") is None:
        raise RuntimeError("git_runtime_missing")
    event("preflight_verified", count=17, sha=sha[:12])
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    with tempfile.TemporaryDirectory(prefix="horizon-railway-team-") as temp:
        root = Path(temp) / "executor"
        count = fetch_source(sha, root)
        event("source_loaded", count=count)
        target = install_dependency(env, target=Path(temp) / "deps")
        if target:
            env["PYTHONPATH"] = str(target) + os.pathsep + env.get("PYTHONPATH", "")
        env["HORIZON_STATE_BACKEND"] = "github-sqlite"
        env["GITHUB_REPOSITORY"] = REPO
        while not stop:
            # Recheck single-writer precondition in case Actions are re-enabled.
            verify_exclusive(env["GITHUB_TOKEN"])
            run_cycle(root, env)
            for _ in range(SLEEP_SECONDS):
                if stop:
                    break
                time.sleep(1)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        event("stopped", reason=str(error) if isinstance(error, RuntimeError) else type(error).__name__)
        raise SystemExit(2)

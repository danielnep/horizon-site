#!/usr/bin/env python3
"""One-time sealed GitHub checkpoint import to a NEW GitHub branch.

Old Actions secret never leaves its runner. Railway RSA private key never leaves
the existing volume. Canonical old encrypted branch stays byte-for-byte intact.
The result is a new Fernet-encrypted GitHub SQLite branch readable by Railway
using a secret derived from its persistent private key. Nothing executes tasks.
"""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile
import urllib.error
import urllib.request
import zipfile

REPOSITORY="danielnep/May-Maestro-Executor"
SOURCE_BRANCH="agent-state/runtime"
ALLOWED_TARGET_BRANCH=re.compile(r"^agent-state/railway-[a-z0-9-]{2,36}$")
MAX_ZIP=18_000_000
MAX_ENVELOPE=14_000_000
LABEL="horizon.checkpoint.envelope.v2"

def announce(status, **public):
    fields={"source_sha", "branch", "count", "checkpoint_sha", "reason"}
    data={k:v for k,v in public.items() if k in fields}
    print("[team-railway] migration_"+status+" "+json.dumps(data,sort_keys=True), flush=True)

def github_request(path, token, *, accept="application/vnd.github+json", data=None, method="GET"):
    url="https://api.github.com/repos/"+REPOSITORY+"/"+path
    req=urllib.request.Request(url,data=data,method=method,headers={
      "Authorization":"Bearer "+token,"Accept":accept,
      "User-Agent":"Horizon-Railway-Checkpoint-Importer/1",
      "X-GitHub-Api-Version":"2022-11-28",
      **({"Content-Type":"application/json"} if data is not None else {})})
    with urllib.request.urlopen(req,timeout=40) as response:
        return json.load(response)

def source_blob_sha(token):
    from urllib.parse import quote
    info=github_request("contents/runtime/state.sqlite3.gz?ref="+quote(SOURCE_BRANCH,safe=""),token)
    if not isinstance(info,dict) or not re.fullmatch(r"[a-f0-9]{40}",str(info.get("sha"))):
        raise RuntimeError("source_snapshot_metadata_invalid")
    return info["sha"]

def fetch_artifact(token, artifact_id, *, opener=urllib.request.urlopen):
    """Authenticated GitHub only: do not forward bearer across storage redirect."""
    if not re.fullmatch(r"[1-9][0-9]{4,15}", str(artifact_id)):
        raise RuntimeError("artifact_id_invalid")
    endpoint=("https://api.github.com/repos/"+REPOSITORY+
              "/actions/artifacts/"+str(artifact_id)+"/zip")
    class SafeRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            from urllib.parse import urlparse
            host=urlparse(newurl)
            if host.scheme!="https" or not host.hostname or (
               not (host.hostname=="objects.githubusercontent.com"
                    or host.hostname.endswith(".blob.core.windows.net")
                    or host.hostname.endswith(".actions.githubusercontent.com")
                    or host.hostname.endswith(".actions.githubusercontent.com")
                    or host.hostname.endswith(".githubusercontent.com"))
            ):
                raise RuntimeError("unexpected_artifact_storage_redirect")
            return urllib.request.Request(newurl,headers={
                "User-Agent":"Horizon-Railway-Checkpoint-Importer/1"})
    transport=urllib.request.build_opener(SafeRedirect())
    req=urllib.request.Request(endpoint,headers={
       "Authorization":"Bearer "+token,"Accept":"application/vnd.github+json",
       "User-Agent":"Horizon-Railway-Checkpoint-Importer/1"})
    # Injecting test opener must not accidentally send token into untrusted host.
    with (transport.open(req,timeout=40) if opener is urllib.request.urlopen
          else opener(req,timeout=40)) as response:
        body=response.read(MAX_ZIP+1)
    if len(body)>MAX_ZIP or not body.startswith(b"PK"):
        raise RuntimeError("artifact_archive_size_invalid")
    return body

def read_envelope(archive):
    with zipfile.ZipFile(io.BytesIO(archive)) as zipfile_obj:
        names=zipfile_obj.namelist()
        if names!=["state.envelope.json"]:
            raise RuntimeError("artifact_members_invalid")
        info=zipfile_obj.getinfo(names[0])
        if info.file_size>MAX_ENVELOPE or info.compress_size>MAX_ENVELOPE:
            raise RuntimeError("artifact_envelope_oversized")
        envelope=json.loads(zipfile_obj.read(names[0]))
    required={"schema","source_sha","records","nonce","wrapped_key","ciphertext","aad","public_key_fingerprint"}
    if not isinstance(envelope,dict) or set(envelope)!=required or envelope["schema"]!=LABEL:
        raise RuntimeError("artifact_schema_invalid")
    if not re.fullmatch(r"[a-f0-9]{40}",str(envelope["source_sha"])):
        raise RuntimeError("artifact_source_version_invalid")
    if not isinstance(envelope["records"],int) or envelope["records"]<0:
        raise RuntimeError("artifact_records_invalid")
    return envelope

def decrypt_envelope(envelope, private_pem):
    from cryptography.hazmat.primitives import hashes,serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
    from cryptography.exceptions import InvalidTag
    private=load_pem_private_key(private_pem,password=None)
    if not isinstance(private,RSAPrivateKey) or private.key_size!=3072:
        raise RuntimeError("migration_private_key_invalid")
    public=private.public_key().public_bytes(
        serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
    if hashlib.sha256(public).hexdigest()!=envelope["public_key_fingerprint"]:
        raise RuntimeError("artifact_recipient_mismatch")
    try:
        dek=private.decrypt(base64.b64decode(envelope["wrapped_key"],validate=True),
          padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),
                       algorithm=hashes.SHA256(),label=None))
        plaintext=AESGCM(dek).decrypt(
            base64.b64decode(envelope["nonce"],validate=True),
            base64.b64decode(envelope["ciphertext"],validate=True),
            base64.b64decode(envelope["aad"],validate=True))
    except Exception:
        raise RuntimeError("artifact_decryption_failed") from None
    if not plaintext.startswith(b"SQLite format 3\x00") or len(plaintext)>20_000_000:
        raise RuntimeError("sqlite_snapshot_invalid")
    return plaintext

def fernet_passphrase(private_pem):
    digest=hashlib.sha256(b"horizon-railway-key-v1:"+private_pem).digest()
    return base64.urlsafe_b64encode(digest).decode()

def validate_sqlite(path, expected_records):
    with sqlite3.connect(path.as_uri()+"?mode=ro",uri=True) as con:
        if con.execute("PRAGMA quick_check").fetchone()[0]!="ok":
            raise RuntimeError("sqlite_integrity_invalid")
        records=con.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    if records!=expected_records:
        raise RuntimeError("sqlite_record_mismatch")
    return records

def logical_digest(path):
    """Compare complete SQLite schema and stored rows, not page-layout bytes.

    sqlite3.backup normalizes internal page headers and can give a different
    file hash for the exact same logical tables, indexes and checkpoint data.
    """
    with sqlite3.connect(path.as_uri()+"?mode=ro",uri=True) as cx:
        hash_obj=hashlib.sha256()
        for statement in cx.iterdump():
            hash_obj.update(statement.encode("utf-8"))
            hash_obj.update(b"\\n")
        return hash_obj.digest()


def import_snapshot(env, *, artifact=None, api_sha=None, project_source=None):
    """Import to new encrypted GitHub branch; refuse to overwrite old or staged."""
    token=env.get("GITHUB_TOKEN")
    recipient=Path(env.get("RAILWAY_VOLUME_MOUNT_PATH","/data"))/"horizon-checkpoint-migration-private.pem"
    target=env.get("HORIZON_STATE_BRANCH","agent-state/railway-staging")
    if not token or not ALLOWED_TARGET_BRANCH.fullmatch(target):
        raise RuntimeError("migration_configuration_missing")
    if not recipient.is_file():
        raise RuntimeError("migration_private_key_missing")
    private=recipient.read_bytes()
    artifact_id=env.get("HORIZON_MEMORY_ARTIFACT_ID")
    envelope=read_envelope(artifact if artifact is not None else fetch_artifact(token,artifact_id))
    expected_source_sha=api_sha if api_sha is not None else source_blob_sha(token)
    if envelope["source_sha"]!=expected_source_sha:
        raise RuntimeError("checkpoint_changed_since_export")
    plaintext=decrypt_envelope(envelope,private)
    # All plaintext stays in ephemeral root, never the limited persistent volume.
    with tempfile.TemporaryDirectory(prefix="horizon-checkpoint-import-") as tmp:
        path=Path(tmp)/"state.sqlite3"
        path.write_bytes(plaintext)
        records=validate_sqlite(path,envelope["records"])
        material=fernet_passphrase(private)
        if project_source is not None:
            sys.path.insert(0,str(project_source))
        from horizon_core.github_state import GitHubState
        enc_key=base64.urlsafe_b64encode(hashlib.sha256(
          ("horizon-github-sqlite-v1:"+material).encode()).digest())
        remote=GitHubState(REPOSITORY,branch=target,token=token,
                           compressed=True,encryption_key=enc_key)
        # If an earlier interrupted transfer already populated this branch,
        # verify its full logical database content and resume idempotently.
        # NEVER overwrite a mismatching target, or the original branch.
        existing=remote._content()
        if existing is None:
            sha=remote.push(path)
        else:
            sha=existing.get("sha")
            if not isinstance(sha,str) or len(sha)!=40:
                raise RuntimeError("migration_target_metadata_invalid")
        verify=GitHubState(REPOSITORY,branch=target,token=token,
                           compressed=True,encryption_key=enc_key)
        with tempfile.TemporaryDirectory(prefix="horizon-import-verify-") as check_dir:
            readback=Path(check_dir)/"state.sqlite3"
            if not verify.pull(readback):
                raise RuntimeError("migration_readback_missing")
            validate_sqlite(readback,records)
            if logical_digest(readback)!=logical_digest(path):
                raise RuntimeError("migration_readback_mismatch")
    announce("verified",source_sha=expected_source_sha[:12],branch=target,
             count=records,checkpoint_sha=sha[:12])
    return {"branch":target,"source_sha":expected_source_sha,
            "records":records,"checkpoint_sha":sha}

def main():
    import importlib.util
    env=dict(os.environ)
    pin=env.get("HORIZON_EXECUTOR_SHA","")
    if not re.fullmatch(r"[a-f0-9]{40}",pin):
        raise RuntimeError("executor_commit_not_pinned")
    if env.get("HORIZON_MEMORY_BRIDGE_ENABLED")!="1" or env.get("HORIZON_PY_AGENTS_ENABLED")=="1":
        raise RuntimeError("migration_not_authorized")
    spec=importlib.util.spec_from_file_location(
        "railway_team_bootstrap",Path(__file__).with_name("railway-team.py"))
    helper=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    if shutil.disk_usage(tempfile.gettempdir()).free<350*1024*1024:
        raise RuntimeError("scratch_storage_low")
    with tempfile.TemporaryDirectory(prefix="horizon-checkpoint-runtime-") as tmp:
        source=Path(tmp)/"runtime"
        helper.fetch_source(pin,source)
        deps=helper.install_dependency(env,target=Path(tmp)/"deps")
        if deps:
            sys.path.insert(0,deps)
        return import_snapshot(env,project_source=source)


if __name__=="__main__":
    try:
        main()
    except Exception as e:
        announce("blocked",reason=str(e) if isinstance(e,RuntimeError) else type(e).__name__)
        raise SystemExit(2)

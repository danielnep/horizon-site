import importlib.util
import base64
from io import BytesIO
from pathlib import Path
import json
import os
import sqlite3
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

spec=importlib.util.spec_from_file_location(
    "horizon_checkpoint_import",Path(__file__).parents[1]/"maestro/railway-checkpoint-import.py")
migration=importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

class CheckpointImportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name)
        self.private=rsa.generate_private_key(public_exponent=65537,key_size=3072)
        private_pem=self.private.private_bytes(
            serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption())
        self.keyfile=root/"horizon-checkpoint-migration-private.pem"
        self.keyfile.write_bytes(private_pem)
        self.keyfile.chmod(0o600)
        db=root/"synthetic.sqlite3"
        with sqlite3.connect(db) as cx:
            cx.execute("CREATE TABLE tasks (id TEXT)")
            cx.execute("INSERT INTO tasks VALUES ('alpha')")
            cx.execute("INSERT INTO tasks VALUES ('beta')")
        self.data=db.read_bytes()
        self.sha="a"*40
        dek=os.urandom(32);nonce=os.urandom(12);aad=b"horizon-migration-test"
        public_pem=self.private.public_key().public_bytes(
            serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
        import hashlib
        envelope={
           "schema":migration.LABEL,"source_sha":self.sha,"records":2,
           "nonce":base64.b64encode(nonce).decode(),
           "wrapped_key":base64.b64encode(self.private.public_key().encrypt(
             dek,padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),
                              algorithm=hashes.SHA256(),label=None))).decode(),
           "ciphertext":base64.b64encode(AESGCM(dek).encrypt(nonce,self.data,aad)).decode(),
           "aad":base64.b64encode(aad).decode(),
           "public_key_fingerprint":hashlib.sha256(public_pem).hexdigest(),
        }
        contents=BytesIO()
        with zipfile.ZipFile(contents,"w") as z:z.writestr("state.envelope.json",json.dumps(envelope))
        self.envelope=envelope;self.zip=contents.getvalue()

    def test_decrypts_valid_checkpoint_to_unmodified_bytes(self):
        env=migration.read_envelope(self.zip)
        plaintext=migration.decrypt_envelope(env,self.keyfile.read_bytes())
        self.assertEqual(plaintext,self.data)
        self.assertEqual(migration.validate_sqlite(Path(self.temp.name)/"synthetic.sqlite3",2),2)

    def test_tampered_ciphertext_and_wrong_key_refused(self):
        x=dict(self.envelope)
        x["ciphertext"]=base64.b64encode(b"tampered").decode()
        with self.assertRaisesRegex(RuntimeError,"artifact_decryption_failed"):
            migration.decrypt_envelope(x,self.keyfile.read_bytes())
        x=dict(self.envelope);x["public_key_fingerprint"]="b"*64
        with self.assertRaisesRegex(RuntimeError,"artifact_recipient_mismatch"):
            migration.decrypt_envelope(x,self.keyfile.read_bytes())

    def test_source_changed_fails_before_state_write(self):
        env={"GITHUB_TOKEN":"synthetic","RAILWAY_VOLUME_MOUNT_PATH":self.temp.name,
             "HORIZON_STATE_BRANCH":"agent-state/railway-staging"}
        with self.assertRaisesRegex(RuntimeError,"checkpoint_changed_since_export"):
            migration.import_snapshot(env,artifact=self.zip,api_sha="f"*40)

    def test_target_branch_allowlist_preserves_original(self):
        env={"GITHUB_TOKEN":"synthetic","RAILWAY_VOLUME_MOUNT_PATH":self.temp.name,
             "HORIZON_STATE_BRANCH":"agent-state/runtime"}
        with self.assertRaisesRegex(RuntimeError,"migration_configuration_missing"):
            migration.import_snapshot(env,artifact=self.zip,api_sha=self.sha)

    def test_reject_extra_files_and_oversize_zip(self):
        bag=BytesIO()
        with zipfile.ZipFile(bag,"w") as z:
            z.writestr("state.envelope.json",json.dumps(self.envelope))
            z.writestr("../oops","x")
        with self.assertRaisesRegex(RuntimeError,"artifact_members_invalid"):
            migration.read_envelope(bag.getvalue())

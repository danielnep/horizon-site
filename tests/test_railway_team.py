import importlib.util
from io import BytesIO
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "horizon_railway_team", Path(__file__).parents[1] / "maestro/railway-team.py")
team = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(team)


class Response:
    def __init__(self, body):
        self.stream = BytesIO(body)
    def __enter__(self):
        return self.stream
    def __exit__(self, *args):
        self.stream.close()


class RailwayTeamTests(unittest.TestCase):
    def test_exclusive_writer_requires_both_github_workflows_disabled(self):
        def opener(request, timeout=None):
            state = "active" if "chat-requests" in request.full_url else "disabled_manually"
            return Response(json.dumps({"state": state}).encode())
        with self.assertRaisesRegex(RuntimeError, "github_actions_still_active"):
            team.verify_exclusive("synthetic", opener=opener)
        def disabled(request, timeout=None):
            return Response(b'{"state":"disabled_manually"}')
        self.assertTrue(team.verify_exclusive("synthetic", opener=disabled))

    def test_credentials_and_pinned_sha_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError, "missing_protected_credentials"):
            team.verify_environment({})
        env = {k:"synthetic" for k in (
            "GITHUB_TOKEN", "HORIZON_SQLITE_ENCRYPTION_KEY", "KERNEL_API_KEY")}
        env.update(HORIZON_EXECUTOR_SHA="b"*40,
                   HORIZON_AGENT_ACTIONS_DISABLED="1", GEMINI_API_KEY="fake")
        self.assertEqual(team.verify_environment(env), "b"*40)
        with self.assertRaisesRegex(RuntimeError, "single_writer_not_armed"):
            team.verify_environment(dict(env,HORIZON_AGENT_ACTIONS_DISABLED="0"))

    def test_archive_is_bound_and_cannot_write_outside_temp(self):
        sha = "f"*40
        blob = BytesIO()
        with tarfile.open(fileobj=blob,mode="w:gz") as tar:
            for name in ("repo-commit/horizon_core/commit_bridge.py",
                         "repo-commit/horizon_core/worker.py",
                         "repo-commit/horizon_core/direct_chat.py"):
                data=b"TEST"
                info=tarfile.TarInfo(name)
                info.size=len(data)
                tar.addfile(info, BytesIO(data))
        archive=blob.getvalue()
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/"executor"
            self.assertEqual(team.fetch_source(sha,target,
                opener=lambda *_a,**_k: Response(archive)),3)
            self.assertEqual((target/"horizon_core/worker.py").read_bytes(),b"TEST")

        evil=BytesIO()
        with tarfile.open(fileobj=evil,mode="w:gz") as tar:
            info=tarfile.TarInfo("root/../../escape.py")
            info.size=4
            tar.addfile(info,BytesIO(b"EVIL"))
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError,"invalid_source_archive"):
                team.fetch_source(sha,Path(tmp)/"executor",
                                  opener=lambda *_a,**_k:Response(evil.getvalue()))
            self.assertFalse((Path(tmp)/"escape.py").exists())

    def test_worker_session_is_bounded_and_no_secrets_in_arguments(self):
        with tempfile.TemporaryDirectory() as tmp:
            invoked=[]
            def runner(args,**kwargs):
                invoked.append((args,kwargs))
                return types.SimpleNamespace(returncode=0)
            fake=types.SimpleNamespace(free=1024*1024*1024)
            with patch.object(team.shutil,"disk_usage",return_value=fake):
                result=team.run_cycle(Path(tmp),{"GITHUB_TOKEN":"test-secret"},run=runner)
            self.assertEqual(result,0)
            args,options=invoked[0]
            self.assertNotIn("test-secret"," ".join(args))
            self.assertEqual(options["timeout"], team.SESSION_SECONDS+65)
            self.assertEqual(options["env"]["GITHUB_TOKEN"],"test-secret")
            assert options["preexec_fn"] is not None
            with patch.object(team.shutil,"disk_usage",return_value=types.SimpleNamespace(free=10)):
                with self.assertRaisesRegex(RuntimeError,"scratch_storage_low"):
                    team.run_cycle(Path(tmp),{},run=runner)


if __name__=="__main__":
    unittest.main()

import base64
import hashlib
import importlib.util
from io import BytesIO, StringIO
from contextlib import redirect_stdout
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
        with tempfile.TemporaryDirectory() as temp:
            key = Path(temp) / "horizon-checkpoint-migration-private.pem"
            key.write_text("synthetic private key bytes for derivation")
            key.chmod(0o600)
            env = {k:"synthetic" for k in (
                "GITHUB_TOKEN",)}
            env.update(HORIZON_EXECUTOR_SHA="b"*40,
                       HORIZON_STATE_BRANCH="agent-state/railway-staging",
                       RAILWAY_VOLUME_MOUNT_PATH=temp,
                       HORIZON_AGENT_ACTIONS_DISABLED="1", GEMINI_API_KEY="fake")
            self.assertEqual(team.verify_environment(env), "b"*40)
            self.assertTrue(len(env.get("HORIZON_SQLITE_ENCRYPTION_KEY",""))>=24)
            with self.assertRaisesRegex(RuntimeError, "single_writer_not_armed"):
                team.verify_environment(dict(env,HORIZON_AGENT_ACTIONS_DISABLED="0"))
            with self.assertRaisesRegex(RuntimeError, "railway_state_branch_invalid"):
                team.verify_environment(dict(env,HORIZON_STATE_BRANCH="agent-state/runtime"))

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

    def test_cycle_logs_only_allowlisted_diagnostics_without_customer_payload(self):
        fake=types.SimpleNamespace(
            returncode=1,
            stdout='\n'.join([
                json.dumps({'event': 'may_delegation_released',
                            'task_id':'chat-a-ronda-pro-mobile-field-20261019',
                            'delegated_count':5,'qa_verified':False,
                            'raw_secret':'VERY_PRIVATE'}),
                json.dumps({'processed':8,'rejected':1,'ready_for_continuation':2,
                            'notes':'PRIVATE_CLIENT'} ),
                json.dumps({'review_delivery_error':'GitHubStateError',
                            'request_id':'test',
                            'reply':'PRIVATE_CLIENT'}),
                json.dumps({'request_id':'test',
                            'raw_payload':'PRIVATE_CLIENT'}),
            ]),
            stderr='Traceback (most recent call last):\nRuntimeError: PRIVATE_CLIENT TOKEN=VERY_PRIVATE')
        observed=[]
        with patch.object(team,'event',side_effect=lambda kind,**kw:observed.append((kind,kw))):
            team.report_cycle_telemetry(fake)
        kinds=[n for n,_ in observed]
        self.assertEqual(kinds,['delegation_released','cycle_summary',
                                'delivery_error','cycle_failed'])
        self.assertEqual(observed[0][1]['delegatedCount'],5)
        self.assertFalse(observed[0][1]['qaVerified'])
        self.assertEqual(observed[1][1]['rejected'],1)
        self.assertEqual(observed[-1][1]['errorClass'],'RuntimeError')
        self.assertNotIn('PRIVATE_CLIENT',json.dumps(observed))
        self.assertNotIn('VERY_PRIVATE',json.dumps(observed))
        # Crucial: exercise the REAL event allowlist, not a mocked logger.
        text_sink=StringIO()
        with redirect_stdout(text_sink):
            team.report_cycle_telemetry(fake)
        delivered=text_sink.getvalue()
        self.assertIn('"processed": 8',delivered)
        self.assertIn('"rejected": 1',delivered)
        self.assertIn('"delegatedCount": 5',delivered)
        self.assertIn('"errorClass": "RuntimeError"',delivered)
        self.assertIn('"errorKind": "GitHubStateError"',delivered)
        self.assertNotIn('PRIVATE_CLIENT',delivered)
        self.assertNotIn('VERY_PRIVATE',delivered)

    def test_cycle_diagnostics_report_only_known_codes_and_reset_receipt(self):
        fake = types.SimpleNamespace(
            returncode=1,
            stdout=json.dumps({'queue_reset': {'applied': True, 'removed': 12,
                                                'secret': 'PRIVATE_TOKEN'}}),
            stderr='Traceback (most recent call last):\nRuntimeError: Queue not empty after owner reset')
        buffer = StringIO()
        with redirect_stdout(buffer):
            team.report_cycle_telemetry(fake)
        result = buffer.getvalue()
        self.assertIn('"applied": true', result)
        self.assertIn('"removed": 12', result)
        self.assertIn('"errorKind": "QueueResetAssertion"', result)
        self.assertNotIn('PRIVATE_TOKEN', result)
        unknown = types.SimpleNamespace(returncode=1, stdout='', stderr='RuntimeError: SECRET_TOKEN')
        buffer = StringIO()
        with redirect_stdout(buffer):
            team.report_cycle_telemetry(unknown)
        self.assertIn('"errorKind": "UnclassifiedFailure"', buffer.getvalue())
        self.assertNotIn('SECRET_TOKEN', buffer.getvalue())

    def test_supervisor_telemetry_is_typed_and_hides_private_data(self):
        fake=types.SimpleNamespace(returncode=0,stderr='',stdout='\n'.join([
            json.dumps({'supervisor_recovery':2,'payload':'PRIVATE_CLIENT'}),
            json.dumps({'supervisor_rejection':'reservas-proof-v1',
                        'errorKind':'ValueError','details':'PRIVATE_CLIENT'}),
            json.dumps({'supervisor_rejection':'../../secret',
                        'errorKind':'ValueError'}),
            json.dumps({'processed':0,'rejected':0,'deferred':9,
                        'ready_for_continuation':0})
        ]))
        buffer=StringIO()
        with redirect_stdout(buffer):
            team.report_cycle_telemetry(fake)
        result=buffer.getvalue()
        self.assertIn('supervisor_recovery',result)
        self.assertIn('supervisor_rejection',result)
        self.assertIn('"deferred": 9',result)
        self.assertNotIn('PRIVATE_CLIENT',result)
        self.assertNotIn('../../secret',result)

    def test_supervisor_wait_logs_only_safe_reason_and_deadline(self):
        waiting = {'supervisor_wait':'ctl-synthetic-123','reason':'scheduled_retry',
                   'task_id':'chat-ctl-synthetic-123:ui',
                   'agent':'ui-ux-designer','retry_reason':'groq_capacity_wait',
                   'next_retry_at':'2026-10-21T09:00:00Z',
                   'blocked_by':[], 'secret':'DO_NOT_LOG'}
        fake = types.SimpleNamespace(returncode=0,stderr='',
                    stdout=json.dumps(waiting)+'\n'+json.dumps(
                        dict(waiting,supervisor_wait='../../secret')))
        buffer=StringIO()
        with redirect_stdout(buffer):
            team.report_cycle_telemetry(fake)
        output=buffer.getvalue()
        self.assertIn('supervisor_wait',output)
        self.assertIn('groq_capacity_wait',output)
        self.assertIn('nextRetryAt',output)
        self.assertNotIn('DO_NOT_LOG',output)
        self.assertNotIn('../../secret',output)

    def test_railway_inbox_fingerprint_detects_new_owner_task(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(team.direct_inventory(tmp)[0], 0)
            inbox=Path(tmp)/'requests'
            (inbox/'romaneio-visual.json').write_text(
                json.dumps({'task_id':'romaneio-visual'}))
            count, first=team.direct_inventory(tmp)
            self.assertEqual(count, 1)
            self.assertNotEqual(first,team.direct_inventory(
                Path(tmp)/'unused')[1])
            (inbox/'new-task.json').write_text('{}')
            self.assertEqual(team.direct_inventory(tmp)[0], 2)

    def test_railway_inbox_refuses_symlinks_and_invalid_filenames(self):
        with tempfile.TemporaryDirectory() as tmp:
            inbox=Path(tmp)/'requests'
            inbox.mkdir()
            (inbox/'badfile.txt').write_text('inert')
            with self.assertRaisesRegex(RuntimeError,'filename_invalid'):
                team.direct_inventory(tmp)
            (inbox/'badfile.txt').unlink()
            (inbox/'good-id.json').symlink_to(Path(tmp)/'missing')
            with self.assertRaisesRegex(RuntimeError,'file_invalid'):
                team.direct_inventory(tmp)

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
            self.assertIn("--direct-inbox",args)
            self.assertNotIn("refresh_requests", " ".join(args))
            self.assertEqual(options["timeout"], team.SESSION_SECONDS+65)
            self.assertEqual(options["env"]["GITHUB_TOKEN"],"test-secret")
            assert options["preexec_fn"] is not None
            with patch.object(team.shutil,"disk_usage",return_value=types.SimpleNamespace(free=10)):
                with self.assertRaisesRegex(RuntimeError,"scratch_storage_low"):
                    team.run_cycle(Path(tmp),{},run=runner)


if __name__=="__main__":
    unittest.main()

class ProviderProbeTests(unittest.TestCase):
    def test_probe_logs_only_typed_provider_status(self):
        result=types.SimpleNamespace(returncode=0,stdout='\n'.join([
            json.dumps({'provider_probe':{'route':'primary','ok':True,'provider':'gemini',
                        'private':'DO_NOT_LOG','failures':[]}}),
            json.dumps({'provider_probe':{'route':'forced_fallback','ok':True,'provider':'groq',
                        'failures':[{'provider':'gemini','reason':'server','status':503,
                                     'message':'DO_NOT_LOG'}]}})]))
        seen=[]
        with patch.object(team,'event',side_effect=lambda kind,**kw:seen.append((kind,kw))):
            team.probe_providers(Path('.'),{'HORIZON_PROVIDER_STARTUP_PROBE':'1'},
                                 run=lambda *a,**kw:result)
        self.assertEqual(seen[0][1]['reason'],'ok_gemini')
        self.assertEqual(seen[1][1]['reason'],'ok_groq')
        self.assertEqual(seen[2][1]['count'],503)
        self.assertNotIn('DO_NOT_LOG',str(seen))

import importlib.util
import tempfile
import unittest
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
spec=importlib.util.spec_from_file_location("studio_runtime",Path(__file__).parents[1]/"vps/studio_runtime.py")
studio=importlib.util.module_from_spec(spec)
spec.loader.exec_module(studio)

class StudioRuntimeTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  studio.DB=Path(self.temp.name)/"test.sqlite3"
  studio.initialize()
 def tearDown(self):self.temp.cleanup()
 def send(self,project="fluxo",client="request_001",message="Quais próximos passos?"):
  return studio.submit({"project_id":project,"actor":"maestra","message":message,"client_id":client})
 def test_duplicate_delivery_is_atomic(self):
  with ThreadPoolExecutor(max_workers=5) as pool:
   results=list(pool.map(lambda _:self.send(),range(5)))
  self.assertEqual(len({r["id"] for r in results}),1)
  self.assertEqual(len(studio.history("fluxo")["messages"]),1)
  self.assertEqual(len(studio.history("fluxo")["events"]),1)
 def test_project_history_and_events_are_isolated(self):
  self.send()
  self.send("elo",message="Mensagem exclusiva de Elo")
  self.assertEqual(studio.history("fluxo")["messages"][0]["prompt"],"Quais próximos passos?")
  self.assertEqual(studio.history("elo")["messages"][0]["prompt"],"Mensagem exclusiva de Elo")
  self.assertEqual(studio.history("ronda-pro")["messages"],[])
 def test_new_git_project_history_and_validation(self):
  self.send("romaneio-digital",client="new_project_1")
  self.assertEqual(len(studio.history("romaneio-digital")["messages"]),1)
  self.assertEqual(studio.project_label("horizon-preview"),"Horizon Preview")
  for bad in ("../../etc/passwd","UPPER","a b",""):
   with self.assertRaises(ValueError):studio.validate_project(bad)
 def test_invalid_project_and_retired_agents_never_enqueue(self):
  with self.assertRaises(ValueError):self.send("../etc")
  with self.assertRaises(ValueError):studio.submit({"project_id":"fluxo","actor":"may-maestro","message":"teste","client_id":"request_002"})
  self.assertEqual(studio.roster()["queue"],[])
 def test_restart_preserves_pending_and_marks_inflight_interrupted(self):
  task=self.send()
  with studio.connect() as db:db.execute("UPDATE messages SET status='running' WHERE id=?",(task["id"],))
  self.send(client="request_002")
  studio.initialize()
  rows=studio.history("fluxo")["messages"]
  self.assertEqual([r["status"] for r in rows],["interrupted","queued"])
  self.assertIn("reinício",rows[0]["error"])
  self.assertEqual(studio.history("fluxo")["events"][-1]["event_type"],"task.interrupted")
 def test_roster_requires_real_running_records(self):
  self.assertEqual(len(studio.roster()["agents"]),8)
  self.assertTrue(all(a["status"]=="idle" and a["currentTask"] is None for a in studio.roster()["agents"]))
  task=self.send()
  self.assertEqual(studio.roster()["agents"][0]["status"],"queued")
  with studio.connect() as db:db.execute("UPDATE messages SET status='running' WHERE id=?",(task["id"],))
  self.assertEqual(studio.roster()["agents"][0]["currentTask"],task["id"])
 def test_output_and_errors_are_not_fabricated(self):
  with self.assertRaises(RuntimeError):studio.parse_output('{"status":"ERROR","response":"feito"}')
  with self.assertRaises(RuntimeError):studio.parse_output('not json')
  self.assertEqual(studio.parse_output('{"status":"SUCCESS","response":"Resposta real","conversation_id":"123"}'),("Resposta real","123"))
  self.assertNotIn("secret",studio.safe_error("secret-key"))
  self.assertIn("limite",studio.safe_error("HTTP 429"))
 def test_queue_backpressure_preserves_existing_messages(self):
  for n in range(12):self.send(client="request_"+str(n).zfill(4))
  with self.assertRaises(ValueError):self.send(client="request_excess")
  self.assertEqual(len(studio.roster()["queue"]),12)

if __name__=="__main__":unittest.main()

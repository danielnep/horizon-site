"""Run with: python3 -m unittest discover -s tests -p 'test_vps_control.py'"""
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from vps import central_api as api

class VpsControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name)/"state.sqlite3"
        self.telemetry = Path(self.temp.name)/"telemetry"
        self.telemetry.mkdir()
        conn = sqlite3.connect(self.db)
        conn.executescript("""
          CREATE TABLE tasks(seq INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT UNIQUE, agent TEXT, project TEXT,objective TEXT,payload TEXT,
            depends_on TEXT,status TEXT,priority INTEGER,not_before REAL,attempts INTEGER DEFAULT 0,
            max_attempts INTEGER,lease_owner TEXT,lease_until REAL,checkpoint TEXT,result TEXT,error TEXT,specification TEXT);
          CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT,kind TEXT,data TEXT,created_at REAL);
          CREATE TABLE memory(project TEXT,agent TEXT,key TEXT,value TEXT);
        """)
        conn.commit()
        conn.close()
        self.db_patch=patch.object(api,"DB",self.db)
        self.telemetry_patch=patch.object(api,"TELEMETRY",self.telemetry)
        self.agents_patch=patch.object(api,"registry_ids",return_value=["may-maestro","qa-engineer"])
        self.worker_patch=patch.object(api,"worker_status",return_value={"status":"Worker de teste","lastCycle":None})
        for item in (self.db_patch,self.telemetry_patch,self.agents_patch,self.worker_patch):
            item.start()

    def tearDown(self):
        for item in (self.worker_patch,self.agents_patch,self.telemetry_patch,self.db_patch):
            item.stop()
        self.temp.cleanup()

    def new_task(self,agent="qa-engineer"):
        return api.submit({
           "agent":agent,"repository":"danielnep/romaneio-digital",
           "project":"romaneio-digital","objective":"Examinar os arquivos de interface sem alterar os fluxos existentes.",
           "allowed_paths":["src/**"],"priority":"P2","public_data_confirmed":True,
        })

    def test_snapshot_reports_only_actual_rows(self):
        empty=api.snapshot()
        self.assertEqual(empty["source"],"vps")
        self.assertEqual(empty["tasks"],[])
        self.assertEqual(empty["usage"]["available"],False)
        task=self.new_task()
        snap=api.snapshot()
        self.assertEqual(len(snap["tasks"]),1)
        self.assertEqual(snap["tasks"][0]["id"],task["id"])
        self.assertEqual(snap["tasks"][0]["status"],"na fila")
        self.assertEqual(snap["tasks"][0]["progress"],None)
        self.assertEqual(len(snap["agents"]),2)

    def test_pause_resume_cancel_never_executes_job(self):
        task=self.new_task()
        self.assertEqual(api.task_action(task["id"],"pause")["status"],"pausada")
        with api.database() as db:
            row=db.execute("select not_before,status from tasks where task_id=?",(task["id"],)).fetchone()
            self.assertEqual(row["status"],"queued")
            self.assertEqual(row["not_before"],api.HOLD_UNTIL)
        self.assertEqual(api.snapshot()["tasks"][0]["status"],"pausada")
        self.assertEqual(api.task_action(task["id"],"resume")["status"],"na fila")
        self.assertEqual(api.task_action(task["id"],"cancel")["status"],"cancelada")
        self.assertEqual(api.snapshot()["tasks"][0]["inQueue"],False)
        self.assertEqual(api.task_action(task["id"],"resume")["status"],"na fila")
        with self.assertRaises(ValueError):
            api.task_action(task["id"],"resume")

    def test_agent_hold_rejects_new_request_and_later_restores_queue(self):
        item=self.new_task()
        self.assertEqual(api.agent_action("qa-engineer","pause")["affected"],1)
        self.assertEqual(api.snapshot()["agents"][1]["held"],True)
        with self.assertRaisesRegex(ValueError,"agente_com_novas_tarefas_pausadas"):
            self.new_task()
        self.assertEqual(api.agent_action("qa-engineer","resume")["affected"],1)
        self.assertEqual(api.snapshot()["tasks"][0]["status"],"na fila")
        self.assertFalse(api.snapshot()["agents"][1]["held"])

    def test_reject_invalid_agent_repo_and_active_process_interruptions(self):
        with self.assertRaises(ValueError):
            api.submit({"agent":"root","repository":"anything","objective":"bad"})
        item=self.new_task()
        with api.database(write=True) as db:
            db.execute("update tasks set status='running' where task_id=?",(item["id"],))
        with self.assertRaisesRegex(ValueError,"somente_tarefa_aguardando"):
            api.task_action(item["id"],"cancel")

    def test_actual_provider_usage_not_guessed(self):
        day=api.dt.datetime.now(api.dt.timezone.utc).date().isoformat()
        (self.telemetry/("usage-"+day+".jsonl")).write_text(
          json.dumps({"agent":"qa-engineer","provider":"groq","model":"gpt-oss",
            "input":300,"output":55,"total":355})+"\n")
        usage,_,_=api.activity_data()
        self.assertTrue(usage["available"])
        self.assertEqual(usage["total"],355)
        self.assertEqual(usage["byAgent"]["qa-engineer"]["total"],355)

if __name__ == "__main__":
    unittest.main()

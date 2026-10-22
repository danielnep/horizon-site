#!/usr/bin/env python3
"""Local, authenticated Horizon VPS control API.

Operates only via an AF_UNIX socket shared with the Horizon Site container.
Uses the SAME SQLite database as the dedicated worker. It never starts or
stops that worker, and never reveals secrets, prompts, memory or full outputs.
"""
import datetime as dt
import hmac
import json
import os
import re
import sqlite3
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from socketserver import ThreadingMixIn, UnixStreamServer
from urllib.parse import urlparse

DB = Path(os.getenv("HORIZON_ACTIVE_DB", "/var/lib/horizon-worker/state/active.sqlite3"))
TELEMETRY = Path(os.getenv("HORIZON_VPS_TELEMETRY", "/var/lib/horizon-worker/workspace/tasks/telemetry"))
SOCKET = Path(os.getenv("HORIZON_VPS_API_SOCKET", "/run/horizon-central/control.sock"))
ID = re.compile(r"^[a-z0-9][a-z0-9:-]{2,110}$")
AGENT = re.compile(r"^[a-z0-9][a-z0-9-]{2,79}$")
HOLD_UNTIL = 4102444800.0  # 2100: safe not_before gate, not a fabricated completion
BATCH = 200
CHECKS = {"queued": "na fila", "running": "em execução", "succeeded": "concluída",
          "failed": "falhou", "blocked": "bloqueada"}
KNOWN_AGENTS = (
 "may-maestro", "ui-ux-designer", "frontend-engineer", "backend-engineer",
 "mobile-app-builder", "qa-engineer", "security-engineer", "devops-engineer",
 "database-engineer", "corregedoria-may", "horizon-skills", "studio-horizon",
)
# The authoritative full specialist list is loaded from the worker registry.
def registry_ids():
    try:
        from horizon_core.registry import AGENT_IDS
        return sorted(set(AGENT_IDS))
    except Exception:
        return []


def json_or(raw, default=None):
    try:
        return json.loads(raw) if isinstance(raw, str) else default
    except (json.JSONDecodeError, TypeError, ValueError):
        return default


def timestamp(value):
    if isinstance(value, (int, float)) and value > 0:
        return dt.datetime.fromtimestamp(value, dt.timezone.utc).isoformat()
    return None


def database(*, write=False):
    if not DB.is_file():
        raise RuntimeError("banco_ativo_nao_encontrado")
    if write:
        db = sqlite3.connect(DB, timeout=8, isolation_level=None)
    else:
        db = sqlite3.connect(DB.as_uri() + "?mode=ro", uri=True, timeout=8)
        db.execute("PRAGMA query_only=ON")
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=8000")
    return db


def ensure_tables(db):
    db.execute("""CREATE TABLE IF NOT EXISTS horizon_control_tasks(
       task_id TEXT PRIMARY KEY, state TEXT NOT NULL,
       original_not_before REAL, source TEXT NOT NULL,
       changed_at REAL NOT NULL
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS horizon_control_agents(
       agent TEXT PRIMARY KEY, paused_at REAL NOT NULL
    )""")


def activity_data(days=7):
    today = dt.datetime.now(dt.timezone.utc).date()
    usage = {"available": False, "input": 0, "output": 0, "total": 0,
             "calls": 0, "days": days, "byAgent": {}, "byProvider": {}, "byModel": {}}
    latest = {}
    recent = []
    for elapsed in range(days):
        stamp = (today - dt.timedelta(days=elapsed)).isoformat()
        for kind in ("usage", "activity"):
            if kind == "activity" and elapsed > 1:
                continue
            path = TELEMETRY / f"{kind}-{stamp}.jsonl"
            try:
                if not path.is_file() or path.stat().st_size > 8_000_000:
                    continue
                with path.open(encoding="utf-8") as stream:
                    for line in stream:
                        if len(line) > 900:
                            continue
                        item = json_or(line)
                        if not isinstance(item, dict):
                            continue
                        if kind == "usage":
                            inp, out, total = item.get("input"), item.get("output"), item.get("total")
                            if not any(isinstance(x, int) and x >= 0 for x in (inp, out, total)):
                                continue
                            inp, out = (inp if isinstance(inp, int) and inp >= 0 else 0,
                                        out if isinstance(out, int) and out >= 0 else 0)
                            total = total if isinstance(total, int) and total >= 0 else inp + out
                            usage["available"] = True
                            usage["input"] += inp
                            usage["output"] += out
                            usage["total"] += total
                            usage["calls"] += 1
                            for name, label in (("byAgent", "agent"), ("byProvider", "provider"), ("byModel", "model")):
                                key = str(item.get(label) or "")[:100]
                                if not key:
                                    continue
                                slot = usage[name].setdefault(key, {"input": 0, "output": 0, "total": 0, "calls": 0})
                                slot["input"] += inp
                                slot["output"] += out
                                slot["total"] += total
                                slot["calls"] += 1
                        else:
                            task_id, agent, action = item.get("taskId"), item.get("agent"), item.get("action")
                            if not (isinstance(task_id, str) and ID.fullmatch(task_id)
                                    and isinstance(agent, str) and AGENT.fullmatch(agent)
                                    and isinstance(action, str) and len(action) < 40):
                                continue
                            event = {"at": str(item.get("at") or "")[:60], "taskId": task_id,
                                     "agent": agent, "action": action,
                                     "step": item.get("step") if isinstance(item.get("step"), int) else None,
                                     "path": str(item.get("path"))[:140] if isinstance(item.get("path"), str) else None}
                            if task_id not in latest or event["at"] >= latest[task_id]["at"]:
                                latest[task_id] = event
                            recent.append(event)
            except (OSError, UnicodeError):
                continue
    return usage, latest, sorted(recent, key=lambda x: x["at"])[-80:]


def worker_status():
    try:
        result = subprocess.run(["systemctl", "is-active", "horizon-worker.service"],
                                capture_output=True, text=True, timeout=3, check=False)
        state = result.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        state = "unknown"
    descriptions = {"active": "Serviço do Maestro ativo", "inactive": "Serviço do Maestro parado",
                    "failed": "Serviço do Maestro com falha"}
    reported = None
    path = Path("/var/lib/horizon-worker/report/latest.json")
    if path.is_file():
        try:
            reported = timestamp(path.stat().st_mtime)
        except OSError:
            pass
    return {"status": descriptions.get(state, "Sem confirmação do estado do Maestro"),
            "lastCycle": {"at": reported} if reported else None}


def snapshot():
    usage, latest, activity = activity_data()
    with database() as db:
        tasks = db.execute(
            """SELECT seq,task_id,agent,project,objective,status,priority,attempts,
                      max_attempts,not_before,lease_until,depends_on,result,error
               FROM tasks ORDER BY seq DESC LIMIT ?""", (BATCH,)
        ).fetchall()
        try:
            control = {r["task_id"]: dict(r) for r in
                       db.execute("SELECT task_id,state,source FROM horizon_control_tasks")}
            holds = {r["agent"] for r in db.execute("SELECT agent FROM horizon_control_agents")}
        except sqlite3.OperationalError:
            control, holds = {}, set()
        recent = db.execute(
            """SELECT id,task_id,kind,created_at FROM events
               ORDER BY id DESC LIMIT 70""").fetchall()
    rows = []
    running = {}
    for item in tasks:
        tid = item["task_id"]
        status = item["status"]
        c = control.get(tid) or {}
        if c.get("state") == "paused":
            visible_status = "pausada"
        elif c.get("state") == "cancelled":
            visible_status = "cancelada"
        elif status == "queued" and item["not_before"] > time.time() + 15:
            visible_status = "aguardando"
        else:
            visible_status = CHECKS.get(status, "não informado")
        if status == "running":
            running[item["agent"]] = tid
        last = latest.get(tid)
        if last is None:
            # Event metadata is proof of an event, not proof that a file was edited.
            ev = next((e for e in recent if e["task_id"] == tid), None)
            if ev:
                last = {"at": timestamp(ev["created_at"]), "agent": item["agent"],
                        "action": ev["kind"], "step": None, "path": None}
        rows.append({
            "id": tid, "project": item["project"][:90],
            "repository": "", "title": item["objective"][:180],
            "description": item["objective"][:2800],
            "agent": item["agent"], "priority": "P1" if item["priority"] > 0 else "P2",
            "status": visible_status, "rawStatus": status,
            "inQueue": status == "queued" and not c,
            "hasResult": item["result"] is not None,
            "approved": False, "published": False, "progress": None,
            "stages": [], "lastActivity": last,
            "blocker": "Há dependências ou erro registrado" if status == "blocked" else None,
        })
    ids = registry_ids()
    agents = [{"id": aid, "status": "em execução" if aid in running else "sem telemetria individual",
               "held": aid in holds, "currentTask": running.get(aid), "updatedAt": None}
              for aid in ids]
    events = [{"id": e["id"], "kind": "worker", "event": e["kind"],
               "at": timestamp(e["created_at"])} for e in reversed(recent)]
    return {"source": "vps", "at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "tasks": rows, "agents": agents, "activity": activity, "events": events,
            "worker": worker_status(),
            "available": {"queue": True, "results": True, "attendance": bool(running)},
            "usage": usage, "issues": []}


def _valid_agent(agent):
    return isinstance(agent, str) and AGENT.fullmatch(agent) and agent in registry_ids()


def submit(body):
    if not isinstance(body, dict):
        raise ValueError("solicitacao_invalida")
    agent = body.get("agent")
    repo = body.get("repository")
    text = body.get("objective")
    if not _valid_agent(agent):
        raise ValueError("agente_nao_cadastrado")
    if not (isinstance(repo, str) and re.fullmatch(r"danielnep/[A-Za-z0-9._-]{2,90}", repo)):
        raise ValueError("repositorio_invalido")
    if not isinstance(text, str) or not 12 <= len(text) <= 2800:
        raise ValueError("objetivo_invalido")
    paths = body.get("allowed_paths")
    if not isinstance(paths, list) or len(paths) > 35 or not all(isinstance(p, str) and 1 <= len(p) <= 150 for p in paths):
        raise ValueError("arquivos_autorizados_invalidos")
    id_ = "ctl-" + uuid.uuid4().hex[:20]
    priority = {"P0": 5, "P1": 3, "P2": 0, "P3": -1}.get(body.get("priority"), 0)
    payload = {"repository": repo, "allowed_paths": paths,
               "public_data_confirmed": body.get("public_data_confirmed") is True,
               "delivery_type": str(body.get("delivery_type") or "existing_product")[:40]}
    with database(write=True) as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            ensure_tables(db)
            if db.execute("SELECT 1 FROM horizon_control_agents WHERE agent=?", (agent,)).fetchone():
                raise ValueError("agente_com_novas_tarefas_pausadas")
            db.execute("""INSERT INTO tasks
              (task_id,agent,project,objective,payload,depends_on,status,priority,
               not_before,max_attempts,specification)
               VALUES(?,?,?,?,?,?,'queued',?,?,?,?)""",
               (id_, agent, "chat:" + id_, text, json.dumps(payload), "[]", priority, 0, 3,
                json.dumps({"agent": agent, "project": "chat:" + id_,
                            "objective": text, "payload": payload, "depends_on": [],
                            "priority": priority, "not_before": 0, "max_attempts": 3})))
            db.execute("INSERT INTO events(task_id,kind,data,created_at) VALUES(?,?,?,?)",
                       (id_, "enqueued", "{}", time.time()))
            db.execute("COMMIT")
        except Exception:
            db.execute("ROLLBACK")
            raise
    return {"id": id_, "status": "na fila", "transport": "vps_sqlite",
            "note": "Tarefa registrada no banco ativo da VPS; execução ainda não confirmada."}


def _update_task(db, id_, action, now):
    row = db.execute("SELECT task_id,status,agent,not_before,attempts,max_attempts,error FROM tasks WHERE task_id=?", (id_,)).fetchone()
    if row is None:
        raise ValueError("tarefa_nao_encontrada")
    control = db.execute("SELECT state,original_not_before,source FROM horizon_control_tasks WHERE task_id=?", (id_,)).fetchone()
    if action == "pause":
        if row["status"] != "queued" or control:
            raise ValueError("somente_tarefa_aguardando_pode_ser_pausada")
        db.execute("INSERT INTO horizon_control_tasks VALUES(?,?,?,?,?)",
                   (id_, "paused", row["not_before"], "manual", now))
        db.execute("UPDATE tasks SET not_before=? WHERE task_id=?", (HOLD_UNTIL, id_))
    elif action == "cancel":
        if row["status"] != "queued" or control:
            raise ValueError("somente_tarefa_aguardando_pode_ser_cancelada")
        db.execute("INSERT INTO horizon_control_tasks VALUES(?,?,?,?,?)",
                   (id_, "cancelled", row["not_before"], "manual", now))
        db.execute("UPDATE tasks SET status='blocked',error=? WHERE task_id=?",
                   (json.dumps({"reason": "cancelled_by_operator"}), id_))
    elif action == "resume":
        if not control or control["state"] not in ("paused", "cancelled"):
            raise ValueError("tarefa_nao_esta_suspensa")
        if row["status"] == "running" or row["status"] == "succeeded":
            raise ValueError("tarefa_ja_foi_executada")
        db.execute("UPDATE tasks SET status='queued',not_before=?,error=NULL WHERE task_id=?",
                   (max(0, control["original_not_before"] or 0), id_))
        db.execute("DELETE FROM horizon_control_tasks WHERE task_id=?", (id_,))
    elif action == "retry":
        if row["status"] not in ("blocked", "failed") or control:
            raise ValueError("tarefa_nao_esta_em_falha")
        db.execute("""UPDATE tasks SET status='queued',attempts=0,
                 error=NULL,not_before=0,lease_owner=NULL,lease_until=NULL WHERE task_id=?""", (id_,))
    else:
        raise ValueError("comando_invalido")
    db.execute("INSERT INTO events(task_id,kind,data,created_at) VALUES(?,?,?,?)",
               (id_, "central_" + action, "{}", now))
    return {"id": id_, "status": {"pause": "pausada", "cancel": "cancelada", "resume": "na fila",
                                   "retry": "na fila"}[action],
            "note": "Comando aplicado no banco da VPS. Uma execução já iniciada não é interrompida."}


def task_action(task_id, action):
    if not isinstance(task_id, str) or not ID.fullmatch(task_id):
        raise ValueError("identificador_invalido")
    with database(write=True) as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            ensure_tables(db)
            result = _update_task(db, task_id, action, time.time())
            db.execute("COMMIT")
            return result
        except Exception:
            db.execute("ROLLBACK")
            raise


def agent_action(agent, action):
    if not _valid_agent(agent) or action not in ("pause", "resume"):
        raise ValueError("comando_invalido")
    now = time.time()
    with database(write=True) as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            ensure_tables(db)
            if action == "pause":
                db.execute("INSERT OR IGNORE INTO horizon_control_agents VALUES(?,?)", (agent, now))
                rows = db.execute(
                    """SELECT task_id,not_before FROM tasks WHERE agent=? AND status='queued'
                    AND task_id NOT IN (SELECT task_id FROM horizon_control_tasks)""",
                    (agent,)).fetchall()
                for row in rows:
                    db.execute("INSERT INTO horizon_control_tasks VALUES(?,?,?,?,?)",
                               (row["task_id"], "paused", row["not_before"], "agent", now))
                    db.execute("UPDATE tasks SET not_before=? WHERE task_id=?", (HOLD_UNTIL, row["task_id"]))
            else:
                db.execute("DELETE FROM horizon_control_agents WHERE agent=?", (agent,))
                rows = db.execute(
                    """SELECT t.task_id,c.original_not_before FROM tasks t JOIN horizon_control_tasks c
                      ON t.task_id=c.task_id WHERE t.agent=? AND c.state='paused' AND c.source='agent'""",
                    (agent,)).fetchall()
                for row in rows:
                    db.execute("UPDATE tasks SET not_before=? WHERE task_id=?",
                               (row["original_not_before"] or 0, row["task_id"]))
                    db.execute("DELETE FROM horizon_control_tasks WHERE task_id=?", (row["task_id"],))
            db.execute("COMMIT")
        except Exception:
            db.execute("ROLLBACK")
            raise
    return {"agent": agent, "status": "novos pedidos pausados" if action == "pause" else "novos pedidos liberados",
            "affected": len(rows), "note": "Comando aplicado à fila da VPS; processos já iniciados continuam."}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, fmt, *args):
        return

    def send_json(self, status, value):
        raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(raw)

    def handle_request(self):
        token = os.environ.get("HORIZON_VPS_API_TOKEN", "")
        supplied = self.headers.get("Authorization", "")
        if not token or not hmac.compare_digest(supplied, "Bearer " + token):
            return self.send_json(401, {"error": "autorizacao_necessaria"})
        path = urlparse(self.path).path
        try:
            if self.command == "GET" and path == "/v1/snapshot":
                return self.send_json(200, snapshot())
            if self.command != "POST":
                return self.send_json(404, {"error": "rota_nao_encontrada"})
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 8000:
                return self.send_json(413, {"error": "tamanho_invalido"})
            value = json_or(self.rfile.read(length))
            if not isinstance(value, dict):
                return self.send_json(400, {"error": "solicitacao_invalida"})
            if path == "/v1/tasks":
                return self.send_json(201, submit(value))
            hit = re.fullmatch(r"/v1/tasks/([a-z0-9:-]{3,110})/actions", path)
            if hit:
                return self.send_json(200, task_action(hit[1], value.get("action")))
            hit = re.fullmatch(r"/v1/agents/([a-z0-9-]{3,79})/actions", path)
            if hit:
                return self.send_json(200, agent_action(hit[1], value.get("action")))
            return self.send_json(404, {"error": "rota_nao_encontrada"})
        except ValueError as e:
            return self.send_json(409, {"error": str(e)[:100]})
        except (sqlite3.DatabaseError, RuntimeError, OSError):
            return self.send_json(503, {"error": "dados_vps_temporariamente_indisponiveis"})

    do_GET = handle_request
    do_POST = handle_request


class LocalServer(ThreadingMixIn, UnixStreamServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    token = os.environ.get("HORIZON_VPS_API_TOKEN", "")
    if len(token) < 32 or not DB.is_file():
        raise SystemExit("VPS control API requires a strong token and the active database")
    SOCKET.parent.mkdir(mode=0o770, parents=True, exist_ok=True)
    try:
        SOCKET.unlink(missing_ok=True)
    except OSError:
        raise SystemExit("socket cleanup failed")
    old_umask = os.umask(0o007)
    try:
        server = LocalServer(str(SOCKET), Handler)
    finally:
        os.umask(old_umask)
    SOCKET.chmod(0o660)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        SOCKET.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

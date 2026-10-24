"""Durable render queue. Media credentials intentionally never enter the database."""
import json
import os
import sqlite3
import time
from pathlib import Path
from backend.media_lifecycle import serialize_media


def database_path() -> Path:
    return Path(os.environ.get("JOB_DATABASE_PATH", Path(__file__).resolve().parents[1] / "data" / "jobs.sqlite3"))


def connect():
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=30)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("""CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, request TEXT NOT NULL, state TEXT NOT NULL,
        status TEXT NOT NULL, heartbeat REAL NOT NULL, created REAL NOT NULL)""")
    return db


@serialize_media
def enqueue(batch: dict, request: dict, *, retry=False):
    request = {**request, "cookies": None}
    now = time.time()
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute("SELECT status FROM jobs WHERE id=?", (batch["batch_id"],)).fetchone()
        if existing and existing[0] in {"queued", "running"}:
            raise ValueError("This batch is already queued or running")
        if existing and not retry:
            raise ValueError("Batch already exists")
        db.execute("INSERT OR REPLACE INTO jobs VALUES (?,?,?,?,?,COALESCE((SELECT created FROM jobs WHERE id=?),?))",
                   (batch["batch_id"], json.dumps(request), json.dumps(batch), "queued", now, batch["batch_id"], now))


def get_job(batch_id: str):
    with connect() as db:
        row = db.execute("SELECT request,state,status FROM jobs WHERE id=?", (batch_id,)).fetchone()
    return {"request": json.loads(row[0]), "state": json.loads(row[1]), "status": row[2]} if row else None


def save_state(batch: dict):
    status = batch["overall_status"]
    with connect() as db:
        db.execute("UPDATE jobs SET state=?,status=?,heartbeat=? WHERE id=? AND status NOT IN ('cancelling','cancelled')",
                   (json.dumps(batch), status, time.time(), batch["batch_id"]))


def claim_next(stale_seconds=120):
    """Transactionally claim one job, including work interrupted by a crashed worker."""
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT id,request,state FROM jobs WHERE status='queued' OR (status='running' AND heartbeat<?) ORDER BY created LIMIT 1",
                         (time.time() - stale_seconds,)).fetchone()
        if not row:
            return None
        state = json.loads(row[2])
        state["overall_status"] = "running"
        for clip in state["clips"]:
            if clip["status"] in {"pending", "downloading", "transcribing", "tracking", "rendering"}:
                clip.update(status="pending", progress_percent=0)
        db.execute("UPDATE jobs SET state=?,status='running',heartbeat=? WHERE id=?",
                   (json.dumps(state), time.time(), row[0]))
    return row[0], json.loads(row[1]), state


def protected_requests():
    with connect() as db:
        rows = db.execute("SELECT id,request FROM jobs WHERE status IN ('queued','running','cancelling')").fetchall()
    return [(batch_id, json.loads(payload)) for batch_id, payload in rows]


def interrupt(batch_id: str):
    with connect() as db:
        db.execute("UPDATE jobs SET heartbeat=0 WHERE id=? AND status='running'", (batch_id,))


def request_cancel(batch_id):
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT status,state FROM jobs WHERE id=?", (batch_id,)).fetchone()
        if not row:
            return None
        state = json.loads(row[1])
        if row[0] in {"queued", "running", "cancelling"}:
            status = "cancelled" if row[0] == "queued" else "cancelling"
            state["overall_status"] = status
            if status == "cancelled":
                for clip in state["clips"]:
                    if clip["status"] != "completed":
                        clip.update(status="cancelled", progress_percent=0)
            db.execute("UPDATE jobs SET status=?,state=? WHERE id=?", (status, json.dumps(state), batch_id))
        return state


def finish_cancel(batch_id):
    with connect() as db:
        row = db.execute("SELECT state FROM jobs WHERE id=?", (batch_id,)).fetchone()
        state = json.loads(row[0])
        state["overall_status"] = "cancelled"
        for clip in state["clips"]:
            if clip["status"] != "completed":
                clip.update(status="cancelled", progress_percent=0, error_message=None)
        db.execute("UPDATE jobs SET status='cancelled',state=? WHERE id=?", (json.dumps(state), batch_id))
        return state

"""Persistent, versioned analysis artifacts; presentation options never enter keys."""
import hashlib
import json
import os
import sqlite3
import time
from functools import lru_cache
from pathlib import Path
from filelock import FileLock


@lru_cache(maxsize=128)
def _digest(path, size, modified, changed):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_identity(source):
    path = Path(source)
    if path.is_file():
        stat = path.stat()
        return _digest(str(path.resolve()), stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    return str(source)


def cached(kind, identity, compute):
    root = Path(os.environ.get("RENDER_CACHE_DIR", Path(__file__).resolve().parents[1] / "data" / "render_cache"))
    root.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(json.dumps([kind, identity], sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    # The per-key lock also deduplicates simultaneous API/worker requests.
    with FileLock(str(root / (key + ".lock"))):
        with sqlite3.connect(root / "cache.sqlite3", timeout=30) as db:
            db.execute("CREATE TABLE IF NOT EXISTS artifacts (key TEXT PRIMARY KEY, value TEXT, touched REAL)")
            row = db.execute("SELECT value FROM artifacts WHERE key=?", (key,)).fetchone()
            if row:
                db.execute("UPDATE artifacts SET touched=? WHERE key=?", (time.time(), key))
                return json.loads(row[0])
        value = compute()
        with sqlite3.connect(root / "cache.sqlite3", timeout=30) as db:
            db.execute("INSERT OR REPLACE INTO artifacts VALUES (?,?,?)", (key, json.dumps(value), time.time()))
            db.execute("DELETE FROM artifacts WHERE key IN (SELECT key FROM artifacts ORDER BY touched DESC LIMIT -1 OFFSET 2048)")
        return value


def word_cache(identity, start, end, transcript, language, compute):
    return cached("words-v1", [identity, start, end, transcript or [], language, os.environ.get("WHISPER_MODEL", "small")], compute)

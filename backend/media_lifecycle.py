"""Protect media in use from cleanup without importing backend configuration eagerly."""
import functools
import inspect
import threading
from contextlib import contextmanager
from pathlib import Path

_lock = threading.RLock()
_in_use: dict[Path, int] = {}


def serialize_media(function):
    """Do not admit a new job/lease between cleanup's snapshot and deletion."""
    @functools.wraps(function)
    def wrapped(*args, **kwargs):
        from filelock import FileLock
        from backend.services.job_store import database_path
        path = database_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with FileLock(str(path) + ".media.lock"), _lock:
            return function(*args, **kwargs)
    return wrapped


@contextmanager
def media_lease(*paths):
    resolved = {Path(p).resolve() for p in paths if isinstance(p, (str, Path)) and p and not str(p).startswith(("http:", "https:"))}
    with _lock:
        for p in resolved:
            _in_use[p] = _in_use.get(p, 0) + 1
    try:
        yield
    finally:
        with _lock:
            for p in resolved:
                _in_use[p] -= 1
                if not _in_use[p]:
                    del _in_use[p]


def protect_media(function):
    @functools.wraps(function)
    def wrapped(*args, **kwargs):
        bound = inspect.signature(function).bind_partial(*args, **kwargs)
        paths = [value for key, value in bound.arguments.items() if key.endswith("_path") or key in {"video_url", "file_path"}]
        from backend.config import TEMP_DIR, UPLOADS_DIR, EXPORTS_DIR
        filename = bound.arguments.get("output_filename")
        if filename:
            paths.append(TEMP_DIR / filename)
        source = bound.arguments.get("video_url", "")
        if isinstance(source, str) and source.startswith("/api/video/"):
            name = Path(source.split("?")[0]).name
            for root in (TEMP_DIR, UPLOADS_DIR, EXPORTS_DIR):
                paths.extend(p for p in root.glob(f"{Path(name).stem}*") if p.is_file())
        with media_lease(*paths):
            return function(*args, **kwargs)
    return wrapped


def protected_media():
    from backend.config import TEMP_DIR, UPLOADS_DIR, EXPORTS_DIR
    from backend.services.job_store import protected_requests
    with _lock:
        paths = set(_in_use)
    prefixes = []
    for batch_id, request in protected_requests():
        prefixes.append(batch_id)
        references = [request.get("video_url", ""), *[v for k, v in request.get("settings", {}).items() if k.endswith("_path")]]
        for reference in references:
            if not reference or not isinstance(reference, str) or reference.startswith(("http:", "https:")):
                continue
            name = Path(reference).name
            paths.add(Path(reference).resolve())
            for root in (TEMP_DIR, UPLOADS_DIR, EXPORTS_DIR):
                paths.update(p.resolve() for p in root.glob(f"{Path(name).stem}*") if p.is_file())
    return paths, prefixes

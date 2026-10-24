import logging
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple
from backend.media_lifecycle import serialize_media

from backend.config import COOKIES_PATH, ROOT_COOKIES_PATH, TEMP_DIR, UPLOADS_DIR, _base_dir, logger


def get_dir_size_and_count(dir_path) -> Tuple[int, int]:
    p = Path(dir_path)
    total_bytes = 0
    total_files = 0
    if p.exists() and p.is_dir():
        for item in p.rglob("*"):
            if item.is_file():
                try:
                    total_bytes += item.stat().st_size
                    total_files += 1
                except Exception:
                    pass
    return total_files, total_bytes


def get_temp_storage_summary() -> dict:
    """Returns total files, bytes, and formatted size of temp download storage."""
    base_dir = Path(_base_dir)
    f1, b1 = get_dir_size_and_count(TEMP_DIR)
    f2, b2 = get_dir_size_and_count(base_dir / "temp")
    tot_files = f1 + f2
    tot_bytes = b1 + b2
    tot_mb = round(tot_bytes / (1024 * 1024), 2)
    formatted = f"{tot_mb} MB" if tot_mb < 1024 else f"{round(tot_mb / 1024, 2)} GB"
    return {
        "total_files": tot_files,
        "total_bytes": tot_bytes,
        "total_mb": tot_mb,
        "formatted_size": formatted
    }


@serialize_media
def clear_temp_files() -> dict:
    from backend.media_lifecycle import protected_media
    pinned, prefixes = protected_media()
    count = size = 0
    for root in {TEMP_DIR.resolve(), (Path(_base_dir) / "temp").resolve()}:
        if not root.exists():
            continue
        for item in root.rglob("*"):
            if item.is_symlink() or not item.is_file():
                continue
            path = item.resolve()
            if (path.is_relative_to(UPLOADS_DIR.resolve()) or is_protected_system_file(path)
                    or path in pinned or any(prefix in path.name for prefix in prefixes)):
                continue
            try:
                file_size = item.stat().st_size
                item.unlink()
                count += 1
                size += file_size
            except OSError:
                pass
    return {"success": True, "cleared_files": count, "cleared_bytes": size,
            "cleared_mb": round(size / 1024**2, 2), "cookies_preserved": True,
            "has_cookies": False, "message": f"Cleared {count} unused temporary files. Active jobs and source uploads were preserved."}


def is_protected_system_file(p: Path) -> bool:
    """Checks whether a given file/dir is protected (cookies, fonts, etc.)."""
    PROTECTED_COOKIE_NAMES = {"cookies.txt", ".cookies", "youtube_cookies.txt", "cookie.txt"}
    if p.name.lower() in PROTECTED_COOKIE_NAMES:
        return True
    try:
        if COOKIES_PATH.exists() and p.resolve() == COOKIES_PATH.resolve():
            return True
    except Exception:
        pass
    try:
        if ROOT_COOKIES_PATH.exists() and p.resolve() == ROOT_COOKIES_PATH.resolve():
            return True
    except Exception:
        pass
    try:
        from backend.config import FONTS_DIR
        if FONTS_DIR.exists() and (p.resolve() == FONTS_DIR.resolve() or FONTS_DIR.resolve() in p.resolve().parents):
            return True
    except Exception:
        pass
    return False


def cleanup_expired_temp_files(max_age_hours: int = 48) -> dict:
    """
    Cleans up temporary video frames, audio slices, and ASS files that are older than max_age_hours.
    Strictly preserves cookies.txt and active files.
    """
    return auto_cleanup_expired_files(max_age_seconds=max_age_hours * 3600)


@serialize_media
def auto_cleanup_expired_files(
    max_age_seconds: int = 3600,
    max_storage_bytes: int = 5 * 1024 * 1024 * 1024,
    target_reduction_ratio: float = 0.8,
    upload_max_age_seconds: Optional[int] = None,
    export_max_age_seconds: Optional[int] = None,
) -> dict:
    """Deduplicated, job-aware cleanup with separate source and export retention."""
    import time
    from backend.config import EXPORTS_DIR
    from backend.media_lifecycle import protected_media
    if max_age_seconds < 0 or max_storage_bytes < 0 or not 0 < target_reduction_ratio <= 1:
        raise ValueError("Cleanup ages and quota must be nonnegative; target ratio must be in (0, 1]")
    uploads_age = upload_max_age_seconds if upload_max_age_seconds is not None else int(os.environ.get("UPLOAD_MAX_AGE_SECONDS", "86400"))
    exports_age = export_max_age_seconds if export_max_age_seconds is not None else int(os.environ.get("EXPORT_MAX_AGE_SECONDS", "604800"))
    if min(uploads_age, exports_age) < 0:
        raise ValueError("Media retention must be nonnegative")
    roots = {Path(p).resolve() for p in (TEMP_DIR, Path(_base_dir) / "temp", UPLOADS_DIR, EXPORTS_DIR)}
    pinned, prefixes = protected_media()
    now = time.time()
    files = {}
    for root in roots:
        if not root.is_dir():
            continue
        for item in root.rglob("*"):
            if item.is_symlink() or not item.is_file():
                continue
            resolved = item.resolve()
            if not any(resolved.is_relative_to(r) for r in roots):
                continue
            files[resolved] = item

    def protected(path):
        return (is_protected_system_file(path) or any(path == root or path.is_relative_to(root) for root in pinned)
                or any(prefix in path.name for prefix in prefixes))

    def retention(path):
        if path.is_relative_to(UPLOADS_DIR.resolve()):
            return uploads_age
        if path.is_relative_to(EXPORTS_DIR.resolve()):
            return exports_age
        return max_age_seconds

    ttl_files = ttl_bytes = quota_files = quota_bytes = 0
    remaining = []
    for path in files:
        try:
            stat = path.stat()
            if not protected(path) and now - stat.st_mtime > retention(path):
                path.unlink()
                ttl_files += 1
                ttl_bytes += stat.st_size
            else:
                remaining.append((stat.st_mtime, stat.st_size, path))
        except FileNotFoundError:
            continue
        except OSError as exc:
            logger.warning("Cannot clean media %s: %s", path.name, exc)
    total = sum(size for _, size, _ in remaining)
    if total > max_storage_bytes:
        target = int(max_storage_bytes * target_reduction_ratio)
        for mtime, size, path in sorted(remaining):
            if total <= target:
                break
            # Avoid racing newly created files and files used by queued/running jobs.
            if protected(path) or now - mtime < 90:
                continue
            try:
                path.unlink()
                quota_files += 1
                quota_bytes += size
                total -= size
            except FileNotFoundError:
                total -= size
            except OSError as exc:
                logger.warning("Cannot evict media %s: %s", path.name, exc)
    # Recount physical files so races or failed deletes never produce phantom usage.
    total = 0
    for path in files:
        try:
            total += path.stat().st_size
        except FileNotFoundError:
            pass
    return {
        "success": True, "ttl_deleted_files": ttl_files, "ttl_deleted_bytes": ttl_bytes,
        "quota_deleted_files": quota_files, "quota_deleted_bytes": quota_bytes,
        "total_cleaned_files": ttl_files + quota_files,
        "total_cleaned_bytes": ttl_bytes + quota_bytes,
        "total_cleaned_mb": round((ttl_bytes + quota_bytes) / 1024**2, 2),
        "remaining_storage_bytes": total, "remaining_storage_mb": round(total / 1024**2, 2),
        "max_age_seconds": max_age_seconds, "max_storage_bytes": max_storage_bytes,
        "upload_max_age_seconds": uploads_age, "export_max_age_seconds": exports_age,
        "quota_exceeded": total > max_storage_bytes,
    }


def find_git_executable() -> str:
    if shutil.which("git"):
        return "git"
    candidates = [
        Path(os.environ.get("ProgramFiles", "C:\\Program Files")) / "Git" / "cmd" / "git.exe",
        Path(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)")) / "Git" / "cmd" / "git.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Git" / "cmd" / "git.exe",
        Path(os.environ.get("USERPROFILE", "")) / "scoop" / "apps" / "git" / "current" / "bin" / "git.exe",
        Path(os.environ.get("USERPROFILE", "")) / "scoop" / "shims" / "git.exe",
    ]
    for c in candidates:
        if c and c.exists():
            return str(c.resolve())
    return "git"


def run_git_command(args: List[str], cwd: Optional[Path] = None, timeout: int = 15) -> Tuple[int, str, str]:
    """Runs a git command safely and returns (returncode, stdout, stderr)."""
    target_cwd = cwd or Path(_base_dir).parent
    git_bin = find_git_executable()
    try:
        proc = subprocess.run(
            [git_bin] + args,
            cwd=str(target_cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout
        )
        return proc.returncode, proc.stdout.strip(), proc.stderr.strip()
    except Exception as e:
        return -1, "", str(e)


def is_server_environment() -> bool:
    """
    Detects if the application is running in a server/production/containerized environment:
    - Docker container (/.dockerenv, DOCKER_CONTAINER=true, DOKPLOY, etc.)
    - Cloud hosting (VERCEL, RENDER, FLY_ALLOC_ID, RAILWAY_ENVIRONMENT, etc.)
    - Explicit SERVER_MODE=true or ENVIRONMENT=production
    """
    if os.environ.get("SERVER_MODE", "").lower() in ("1", "true", "yes"):
        return True
    if os.environ.get("ENVIRONMENT", "").lower() == "production" or os.environ.get("NODE_ENV", "").lower() == "production":
        return True
    if os.path.exists("/.dockerenv") or os.environ.get("DOCKER_CONTAINER", "").lower() in ("1", "true", "yes"):
        return True
    if any(os.environ.get(k) for k in ("DOKPLOY", "VERCEL", "RENDER", "FLY_ALLOC_ID", "RAILWAY_ENVIRONMENT", "AWS_LAMBDA_FUNCTION_NAME")):
        return True
    return False


def is_update_allowed() -> bool:
    """
    App self-update and server restarts via Web UI are ONLY allowed in local desktop environments.
    In server environments (Docker / Dokploy / Cloud VPS), updates must be handled via orchestrator / git deployment.
    """
    if os.environ.get("ALLOW_SERVER_UPDATE", "").lower() in ("1", "true", "yes"):
        return True
    return not is_server_environment()


def get_current_git_info() -> dict:
    """Retrieves current commit, branch, and remote URL information."""
    root_dir = Path(_base_dir).parent
    rc, commit_info, _ = run_git_command(["log", "-1", "--pretty=format:%h|%H|%s|%cd", "--date=short"], cwd=root_dir)
    rc_branch, branch, _ = run_git_command(["branch", "--show-current"], cwd=root_dir)
    rc_remote, remote_url, _ = run_git_command(["remote", "get-url", "origin"], cwd=root_dir)

    commit_hash = "unknown"
    commit_full = ""
    commit_msg = "Unknown commit"
    commit_date = ""
    if rc == 0 and commit_info:
        parts = commit_info.split("|")
        if len(parts) >= 4:
            commit_hash = parts[0]
            commit_full = parts[1]
            commit_msg = parts[2]
            commit_date = parts[3]

    is_server = is_server_environment()
    allow_update = is_update_allowed()

    return {
        "current_commit": commit_hash,
        "current_commit_full": commit_full,
        "commit_message": commit_msg,
        "commit_date": commit_date,
        "branch": branch if rc_branch == 0 and branch else "master",
        "remote_url": remote_url if rc_remote == 0 and remote_url else "https://github.com/galihjuansaputra/cheat-clip-pro.git",
        "is_server": is_server,
        "allow_update": allow_update
    }


def trigger_detached_restart(delay: float = 2.5):
    """Launches backend/restart_runner.py in a fully detached background process."""
    root_dir = Path(_base_dir).parent
    runner_script = root_dir / "backend" / "restart_runner.py"
    
    flags = (subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS) if os.name == 'nt' else 0
    subprocess.Popen(
        [sys.executable, str(runner_script), "--delay", str(delay), "--cwd", str(root_dir)],
        cwd=str(root_dir),
        creationflags=flags,
        start_new_session=True if os.name != 'nt' else False,
        close_fds=True
    )
    logger.info(f"Detached restart runner spawned with delay={delay}s")

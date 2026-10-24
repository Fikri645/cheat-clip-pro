"""Cancellable source acquisition for browser renders and the subtitle editor."""
import asyncio
import multiprocessing
import queue
from backend.services.process_control import terminate_tree, watch_parent


def download_child(args, snapshots):
    from backend.services.download_service import raw_clip_download_jobs, run_raw_clip_download_job
    watch_parent()
    job_id = args[0]
    raw_clip_download_jobs[job_id] = {"job_id": job_id, "status": "starting"}
    async def run():
        task = asyncio.create_task(run_raw_clip_download_job(*args))
        while not task.done():
            snapshots.put(dict(raw_clip_download_jobs[job_id]))
            await asyncio.wait({task}, timeout=.2)
        await task
        snapshots.put(dict(raw_clip_download_jobs[job_id]))
    asyncio.run(run())


async def managed_clip_download(*args):
    from backend.services.download_service import raw_clip_download_jobs
    from backend.config import TEMP_DIR, EXPORTS_DIR
    job_id = args[0]
    state = raw_clip_download_jobs[job_id]
    context = multiprocessing.get_context("spawn")
    snapshots = context.Queue()
    child = context.Process(target=download_child, args=(args, snapshots))
    child.start()
    try:
        while child.is_alive():
            if state.get("cancel_requested"):
                terminate_tree(child.pid)
                state.update(status="cancelled", progress_percent=0)
                break
            try:
                while True:
                    state.update(snapshots.get_nowait())
            except queue.Empty:
                pass
            await asyncio.sleep(.1)
        child.join(5)
        if not state.get("cancel_requested"):
            try:
                while True:
                    state.update(snapshots.get_nowait())
            except queue.Empty:
                pass
            if state["status"] not in {"ready", "failed"}:
                state.update(status="failed", error="Source download stopped unexpectedly")
    finally:
        if child.is_alive():
            terminate_tree(child.pid)
            child.join(5)
        snapshots.close()
        if state.get("cancel_requested"):
            for root in (TEMP_DIR, EXPORTS_DIR):
                for path in root.glob("*source_" + job_id + "*"):
                    if path.is_file():
                        path.unlink(missing_ok=True)

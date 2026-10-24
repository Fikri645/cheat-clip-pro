"""One isolated render worker per database, with durable per-clip checkpoints."""
import asyncio
import queue
import time

from filelock import FileLock, Timeout

from backend.services import job_store


async def _render(batch_id, payload, state, credentials):
    from backend.schemas.render import RenderBatchRequest
    from backend.services.render_service import BATCH_REQUESTS, RENDER_BATCHES, process_batch_rendering
    request = RenderBatchRequest.model_validate({**payload, "cookies": credentials})
    RENDER_BATCHES[batch_id] = state
    BATCH_REQUESTS[batch_id] = request
    task = asyncio.create_task(process_batch_rendering(batch_id, request))
    try:
        while not task.done():
            job_store.save_state(state)
            await asyncio.wait({task}, timeout=1)
        await task
    except Exception as exc:
        from backend.security import mask_sensitive_text
        state.update(overall_status="error", error_message=mask_sensitive_text(str(exc)))
    finally:
        job_store.save_state(state)
        RENDER_BATCHES.pop(batch_id, None)
        BATCH_REQUESTS.pop(batch_id, None)


def render_job(batch_id, payload, state, cookies):
    from backend.services.process_control import watch_parent
    watch_parent()
    # A replacement supervisor waits for an orphan from a crashed supervisor.
    with FileLock(str(job_store.database_path()) + ".execution.lock"):
        asyncio.run(_render(batch_id, payload, state, cookies))


def cleanup_cancelled(batch_id):
    from backend.config import TEMP_DIR, EXPORTS_DIR
    state = job_store.get_job(batch_id)["state"]
    keep = {c.get("output_path") for c in state["clips"] if c["status"] == "completed"}
    for root in (TEMP_DIR, EXPORTS_DIR):
        for path in root.glob("*" + batch_id + "*"):
            if path.is_file() and str(path) not in keep and path.suffix != ".zip":
                path.unlink(missing_ok=True)


def run_worker(stop_event, credential_queue):
    import multiprocessing
    from backend.services.process_control import terminate_tree, watch_parent
    watch_parent()
    context = multiprocessing.get_context("spawn")
    lock = FileLock(str(job_store.database_path()) + ".worker.lock")
    job_store.connect().close()
    try:
        with lock.acquire(timeout=0):
            with job_store.connect() as db:
                db.execute("UPDATE jobs SET heartbeat=0 WHERE status='running'")
                cancelling = [row[0] for row in db.execute("SELECT id FROM jobs WHERE status='cancelling'")]
            for batch_id in cancelling:
                job_store.finish_cancel(batch_id)
                cleanup_cancelled(batch_id)
            credentials = {}
            while not stop_event.is_set():
                while True:
                    try:
                        batch_id, cookies = credential_queue.get_nowait()
                        credentials[batch_id] = cookies
                    except queue.Empty:
                        break
                job = job_store.claim_next()
                if not job:
                    stop_event.wait(.2)
                    continue
                batch_id, payload, state = job
                child = context.Process(target=render_job, args=(batch_id, payload, state, credentials.pop(batch_id, None)))
                child.start()
                while child.is_alive():
                    saved = job_store.get_job(batch_id)
                    if saved["status"] == "cancelling" or stop_event.is_set():
                        terminate_tree(child.pid)
                        child.join(5)
                        if saved["status"] == "cancelling":
                            job_store.finish_cancel(batch_id)
                            cleanup_cancelled(batch_id)
                        else:
                            job_store.interrupt(batch_id)
                        break
                    child.join(.2)
                child.join()
                saved = job_store.get_job(batch_id)
                if saved["status"] == "cancelling":
                    job_store.finish_cancel(batch_id)
                    cleanup_cancelled(batch_id)
                elif child.exitcode and saved["status"] == "running":
                    failed = saved["state"]
                    failed.update(overall_status="error", error_message="Render process stopped unexpectedly. Retry unfinished clips.")
                    for clip in failed["clips"]:
                        if clip["status"] != "completed":
                            clip.update(status="error", error_message=failed["error_message"])
                    job_store.save_state(failed)
    except Timeout:
        return


def start_worker():
    import multiprocessing
    context = multiprocessing.get_context("spawn")
    stop = context.Event()
    credentials = context.Queue()
    worker = context.Process(target=run_worker, args=(stop, credentials), name="clip-render-worker", daemon=False)
    worker.start()
    return worker, stop, credentials

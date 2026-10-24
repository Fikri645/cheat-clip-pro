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


def run_worker(stop_event, credential_queue):
    # OS file locks are released after a crash; acquiring this lock proves there
    # is no previous encoder still writing output before reclaiming its work.
    lock = FileLock(str(job_store.database_path()) + ".worker.lock")
    job_store.connect().close()
    try:
        with lock.acquire(timeout=0):
            with job_store.connect() as db:
                db.execute("UPDATE jobs SET heartbeat=0 WHERE status='running'")
            credentials = {}
            while not stop_event.is_set():
                while True:
                    try:
                        batch_id, cookies = credential_queue.get_nowait()
                        credentials[batch_id] = cookies
                    except queue.Empty:
                        break
                job = job_store.claim_next()
                if job:
                    batch_id, payload, state = job
                    asyncio.run(_render(batch_id, payload, state, credentials.pop(batch_id, None)))
                else:
                    stop_event.wait(0.3)
    except Timeout:
        # Another API process already owns the render worker for this database.
        return


def start_worker():
    import multiprocessing
    context = multiprocessing.get_context("spawn")
    stop = context.Event()
    credentials = context.Queue()
    worker = context.Process(target=run_worker, args=(stop, credentials), name="clip-render-worker", daemon=True)
    worker.start()
    return worker, stop, credentials

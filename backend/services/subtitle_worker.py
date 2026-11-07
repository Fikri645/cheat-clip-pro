"""One warm speech worker, with hard cancellation of only its active request."""
import asyncio
import multiprocessing
import queue
import uuid

from fastapi import HTTPException
from backend.services.process_control import terminate_tree


def subtitle_worker_main(inbox, outbox):
    from backend.services.process_control import watch_parent
    from backend.services.subtitle_words import prepare_subtitle_words
    from backend.security import mask_sensitive_text
    watch_parent()
    while True:
        try:
            task_id, payload = inbox.get(timeout=120)
        except queue.Empty:
            return  # Release model/GPU memory when the editor is idle.
        try:
            outbox.put((task_id, 200, prepare_subtitle_words(payload, task_id)))
        except HTTPException as exc:
            outbox.put((task_id, exc.status_code, exc.detail))
        except Exception as exc:
            outbox.put((task_id, 500, mask_sensitive_text(str(exc))))
        finally:
            payload = None


class SubtitleWorker:
    def __init__(self, target=subtitle_worker_main):
        self.target = target
        self.context = multiprocessing.get_context("spawn")
        self.lock = asyncio.Lock()
        self.process = None
        self.inbox = self.outbox = None

    def close(self):
        if self.process is not None:
            if self.process.is_alive():
                terminate_tree(self.process.pid)
            self.process.join(5)
            self.process.close()
            self.process = None
        for channel in (self.inbox, self.outbox):
            if channel is not None:
                channel.cancel_join_thread()
                channel.close()
        self.inbox = self.outbox = None

    async def run(self, payload, request):
        # A disconnected waiter must not cancel somebody else's active clip.
        while True:
            if await request.is_disconnected():
                raise HTTPException(499, "Subtitle loading cancelled")
            try:
                await asyncio.wait_for(self.lock.acquire(), timeout=.1)
                break
            except asyncio.TimeoutError:
                pass
        task_id = uuid.uuid4().hex
        in_flight = False
        try:
            if await request.is_disconnected():
                raise HTTPException(499, "Subtitle loading cancelled")
            if self.process is None or not self.process.is_alive():
                await asyncio.to_thread(self.close)
                self.inbox, self.outbox = self.context.Queue(), self.context.Queue()
                self.process = self.context.Process(target=self.target, args=(self.inbox, self.outbox))
                self.process.start()
            self.inbox.put((task_id, payload))
            in_flight = True
            while True:
                if await request.is_disconnected():
                    raise HTTPException(499, "Subtitle loading cancelled")
                try:
                    response_id, status, data = self.outbox.get_nowait()
                except queue.Empty:
                    if not self.process.is_alive():
                        # Allow a process's Queue feeder to flush its final result.
                        try:
                            response_id, status, data = await asyncio.to_thread(self.outbox.get, True, .5)
                        except queue.Empty:
                            raise HTTPException(500, "Subtitle worker stopped; retry this clip")
                    else:
                        await asyncio.sleep(.05)
                        continue
                if response_id != task_id:
                    continue
                in_flight = False
                if status != 200:
                    raise HTTPException(status, data)
                return data
        finally:
            try:
                if in_flight:
                    await asyncio.to_thread(self.close)
                from backend.config import TEMP_DIR
                for suffix in (".wav", ".cookies.txt"):
                    (TEMP_DIR / f"subtitle_job_{task_id}{suffix}").unlink(missing_ok=True)
            finally:
                self.lock.release()

"""Prepare word timings and lightweight framing for both browser encoders."""
import asyncio
import base64
import subprocess
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from backend.utils.caption_words import CaptionWord, validate_words
from backend.services.render_cache import cached, source_identity, word_cache

router = APIRouter(tags=["Render"])


class SampleFrame(BaseModel):
    time: float = Field(ge=0)
    jpeg: str = Field(max_length=160000)


class ClientPlanRequest(BaseModel):
    audio_source: str = ""
    start_time: float = Field(0, ge=0)
    audio_start_time: Optional[float] = Field(None, ge=0)
    end_time: float = Field(ge=0)
    frames: list[SampleFrame] = Field(default_factory=list, max_length=240)
    transcript: list[dict] = Field(default_factory=list, max_length=30000)
    caption_style: str = "viral_pop"
    caption_words: Optional[list[CaptionWord]] = Field(None, max_length=10000)
    text_case: str = "uppercase"
    facecam_position: str = "auto"
    streamer_preset: str = "none"


def prepare_plan(request: ClientPlanRequest, scratch_id=None):
    import cv2
    import numpy as np
    from backend.config import TEMP_DIR, FONTS_DIR
    from backend.routers.media import _find_video_file_on_disk, _is_safe_path
    from backend.services.face_tracking import track_frames
    from backend.media_lifecycle import media_lease
    from backend.video_engine import transcribe_clip_words, apply_text_case, clean_caption_text
    from backend.utils.captions import CAPTION_STYLES, caption_events
    if request.end_time <= request.start_time:
        raise HTTPException(status_code=422, detail="Clip end must be later than start")
    def frames():
        for item in request.frames:
            raw = base64.b64decode(item.jpeg.split(",")[-1], validate=True)
            image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
            if image is None or image.shape[0] * image.shape[1] > 2_000_000:
                raise HTTPException(status_code=422, detail="Invalid tracking image")
            yield item.time, image
    trajectory = cached("browser-tracking-v1", [[f.model_dump() for f in request.frames], request.facecam_position, request.streamer_preset],
        lambda: track_frames(frames(), request.facecam_position, request.streamer_preset)) if request.frames else []
    words = []
    if request.caption_style != "none":
        name = request.audio_source.split("?")[0].replace("\\", "/").split("/")[-1]
        source = _find_video_file_on_disk(name) if name else None
        if request.caption_words is not None:
            words = [w.model_dump() for w in request.caption_words]
            try:
                validate_words(words, request.end_time-request.start_time)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc))
        else:
            def transcribe():
                sliced = TEMP_DIR / f"client_words_{scratch_id or uuid.uuid4().hex}.wav"
                with media_lease(source, sliced):
                    try:
                        if source and source.exists() and _is_safe_path(source):
                            subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(request.audio_start_time if request.audio_start_time is not None else request.start_time),
                                            "-i", str(source), "-t", str(request.end_time-request.start_time),
                                            "-vn", "-ar", "16000", "-ac", "1", str(sliced)], check=True, timeout=120)
                        return transcribe_clip_words(str(sliced), request.transcript, request.start_time, request.end_time)
                    finally:
                        sliced.unlink(missing_ok=True)
            target_language = None
            if request.transcript:
                from backend.utils.text import detect_transcript_language
                target_language = detect_transcript_language(request.transcript[:50]).get("code")
                if target_language not in ("id", "en"):
                    target_language = None
            words = word_cache(source_identity(source) if source else request.audio_source,
                request.start_time, request.end_time, request.transcript, target_language, transcribe)
    fonts = [{"name": p.stem, "url": f"/api/font-file/{p.name}"} for p in FONTS_DIR.iterdir() if p.suffix.lower() in {".ttf", ".otf", ".woff", ".woff2"}]
    styled_words = [{**word, "word_text": apply_text_case(clean_caption_text(word["word"]), request.text_case)} for word in words]
    return {"words": words, "caption_events": caption_events(styled_words), "caption_style": CAPTION_STYLES.get(request.caption_style, CAPTION_STYLES["clean_minimal"]), "trajectory": trajectory, "fonts": fonts}


@router.post("/api/client-render-plan")
async def client_render_plan(request: ClientPlanRequest, http_request: Request):
    import multiprocessing
    import queue
    from backend.services.process_control import terminate_tree
    context = multiprocessing.get_context("spawn")
    result = context.Queue()
    scratch_id = uuid.uuid4().hex
    process = context.Process(target=plan_child, args=(request.model_dump(), result, scratch_id))
    process.start()
    try:
        while True:
            if await http_request.is_disconnected():
                raise HTTPException(status_code=499, detail="Render preparation cancelled")
            try:
                status, data = result.get_nowait()
                if status != 200:
                    raise HTTPException(status_code=status, detail=data)
                return data
            except queue.Empty:
                if not process.is_alive():
                    # Queue feeder may flush just after process exit.
                    try:
                        status, data = await asyncio.to_thread(result.get, True, 1)
                    except queue.Empty:
                        raise HTTPException(status_code=500, detail="Render preparation stopped unexpectedly")
                    if status != 200:
                        raise HTTPException(status_code=status, detail=data)
                    return data
                await asyncio.sleep(.1)
    finally:
        if process.is_alive():
            await asyncio.to_thread(terminate_tree, process.pid)
        process.join(5)
        result.close()
        from backend.config import TEMP_DIR
        (TEMP_DIR / f"client_words_{scratch_id}.wav").unlink(missing_ok=True)


def plan_child(payload, result, scratch_id):
    from backend.services.process_control import watch_parent
    from backend.security import mask_sensitive_text
    watch_parent()
    try:
        result.put((200, prepare_plan(ClientPlanRequest.model_validate(payload), scratch_id)))
    except HTTPException as exc:
        result.put((exc.status_code, exc.detail))
    except Exception as exc:
        result.put((500, mask_sensitive_text(str(exc))))

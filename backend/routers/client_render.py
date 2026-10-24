"""Prepare word timings and lightweight framing for both browser encoders."""
import asyncio
import base64
import subprocess
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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
    text_case: str = "uppercase"
    facecam_position: str = "auto"
    streamer_preset: str = "none"


def prepare_plan(request: ClientPlanRequest):
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
    trajectory = track_frames(frames(), request.facecam_position, request.streamer_preset) if request.frames else []
    words = []
    if request.caption_style != "none":
        name = request.audio_source.split("?")[0].replace("\\", "/").split("/")[-1]
        source = _find_video_file_on_disk(name) if name else None
        sliced = TEMP_DIR / f"client_words_{uuid.uuid4().hex}.wav"
        with media_lease(source, sliced):
            try:
                if source and source.exists() and _is_safe_path(source):
                    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(request.audio_start_time if request.audio_start_time is not None else request.start_time),
                                    "-i", str(source), "-t", str(request.end_time-request.start_time),
                                    "-vn", "-ar", "16000", "-ac", "1", str(sliced)], check=True, timeout=120)
                words = transcribe_clip_words(str(sliced), request.transcript, request.start_time, request.end_time)
            finally:
                sliced.unlink(missing_ok=True)
    fonts = [{"name": p.stem, "url": f"/api/font-file/{p.name}"} for p in FONTS_DIR.iterdir() if p.suffix.lower() in {".ttf", ".otf", ".woff", ".woff2"}]
    styled_words = [{**word, "word_text": apply_text_case(clean_caption_text(word["word"]), request.text_case)} for word in words]
    return {"words": words, "caption_events": caption_events(styled_words), "caption_style": CAPTION_STYLES.get(request.caption_style, CAPTION_STYLES["clean_minimal"]), "trajectory": trajectory, "fonts": fonts}


@router.post("/api/client-render-plan")
async def client_render_plan(request: ClientPlanRequest):
    return await asyncio.to_thread(prepare_plan, request)

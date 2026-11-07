"""Load original words with a persistent acoustic model and audio-only sources."""
from fastapi import APIRouter, Request
from backend.services.subtitle_words import SubtitleWordsRequest
from backend.services.subtitle_worker import SubtitleWorker

router = APIRouter(tags=["Subtitles"])
subtitle_worker = SubtitleWorker()


@router.post("/api/subtitle-words")
async def subtitle_words(payload: SubtitleWordsRequest, request: Request):
    return await subtitle_worker.run(payload.model_dump(), request)

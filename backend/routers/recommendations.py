from fastapi import APIRouter,Request,HTTPException
from fastapi.responses import StreamingResponse
from backend.schemas.analyze import ReanalyzeRequest
from backend.services.recommendations import recommendation_events,duration_bounds
from backend.utils.sse import _sse

router=APIRouter(tags=["Analysis"])


@router.post("/api/reanalyze")
async def reanalyze(request:ReanalyzeRequest,http:Request):
    if not request.analysis.transcript:raise HTTPException(422,"This project has no saved transcript. Analyze it first.")
    duration_bounds(request.duration)
    async def stream():
        async for event in recommendation_events(request,http.is_disconnected):yield _sse(event)
    return StreamingResponse(stream(),media_type="text/event-stream",headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})

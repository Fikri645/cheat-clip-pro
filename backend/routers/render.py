import asyncio
import json
import logging
import os
import re
import time
import uuid
import zipfile
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from backend.config import (
    ACTIVE_ENCODER_NAME,
    EXPORTS_DIR,
    detect_hardware_support,
    logger,
)
from backend.schemas.render import (
    RenderBatchRequest,
    RenderSettingsModel,
    RetryBatchRequest,
)
from backend.services import job_store

router = APIRouter(tags=["Render"])


@router.post("/api/render-batch")
async def start_batch_render(request: RenderBatchRequest, http_request: Request):
    if not request.clips:
        raise HTTPException(status_code=400, detail="No clips provided for rendering")

    batch_id = f"batch_{int(time.time())}_{uuid.uuid4().hex[:6]}"

    is_merged = bool(request.settings and getattr(request.settings, "render_mode", "separate") == "merged")
    pfx = (request.settings.title_prefix or "") if request.settings else ""
    sfx = (request.settings.title_suffix or "") if request.settings else ""

    clips_status = []
    if is_merged:
        raw_comp_title = (request.settings.compilation_title or "").strip()
        if not raw_comp_title:
            first_clip = request.clips[0]
            first_base = (first_clip.get("custom_title") or first_clip.get("title_suggestion") or first_clip.get("title") or "Highlight Video").strip()
            raw_comp_title = f"{first_base} (Merged)"
        full_comp_title = f"{pfx}{raw_comp_title}{sfx}".strip() if (pfx or sfx) else raw_comp_title
        clips_status.append({
            "clip_index": 0,
            "title": full_comp_title,
            "base_title": raw_comp_title,
            "status": "pending",
            "progress_percent": 0,
            "is_merged": True,
            "segments_count": len(request.clips)
        })
        batch = {
            "batch_id": batch_id,
            "total_clips": 1,
            "current_clip_index": 0,
            "overall_status": "running",
            "clips": clips_status,
            "zip_url": None,
            "is_merged": True,
            "merged_segments_count": len(request.clips)
        }
    else:
        for idx, c in enumerate(request.clips):
            base_t = (c.get("custom_title") or c.get("title_suggestion") or c.get("title") or f"Clip {idx+1}").strip()
            full_t = f"{pfx}{base_t}{sfx}".strip() if (pfx or sfx) else base_t
            clips_status.append({
                "clip_index": idx,
                "title": full_t,
                "base_title": base_t,
                "status": "pending",
                "progress_percent": 0
            })
        batch = {
            "batch_id": batch_id,
            "total_clips": len(request.clips),
            "current_clip_index": 0,
            "overall_status": "running",
            "clips": clips_status,
            "zip_url": None,
            "is_merged": False
        }

    batch["video_id"] = request.video_id
    if request.cookies:
        http_request.app.state.render_credentials.put((batch_id, request.cookies))
    job_store.enqueue(batch, request.model_dump())
    return {"batch_id": batch_id, "total_clips": 1 if is_merged else len(request.clips), "is_merged": is_merged}


@router.post("/api/render-batch/{batch_id}/cancel")
def cancel_batch(batch_id: str):
    state = job_store.request_cancel(batch_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Batch not found")
    return state


@router.post("/api/render-batch/{batch_id}/retry")
async def retry_batch_rendering(batch_id: str, http_request: Request, body: Optional[RetryBatchRequest] = None):
    job = job_store.get_job(batch_id)
    if not job:
        raise HTTPException(status_code=404, detail="Batch not found")
    if job["status"] in {"queued", "running", "cancelling"}:
        raise HTTPException(status_code=409, detail="Batch is already queued or running")
    batch = job["state"]
    indices = body.clip_indices if body and body.clip_indices is not None else [i for i,c in enumerate(batch["clips"]) if c["status"] in {"error", "cancelled"}]
    if not indices or any(i < 0 or i >= len(batch["clips"]) for i in indices):
        raise HTTPException(status_code=400, detail="No valid failed clips to retry")
    for index in indices:
        batch["clips"][index].update(status="pending", progress_percent=0, error=None, error_message=None)
    batch.update(overall_status="running", error_message=None, warning_message=None)
    if body and body.cookies:
        http_request.app.state.render_credentials.put((batch_id, body.cookies))
    try:
        job_store.enqueue(batch, job["request"], retry=True)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"status": "started", "batch_id": batch_id, "retrying_clips": indices}


@router.get("/api/render-batch/{batch_id}")
def get_batch_snapshot(batch_id: str):
    job = job_store.get_job(batch_id)
    if not job:
        raise HTTPException(status_code=404, detail="Batch not found")
    return job["state"]


@router.get("/api/render-progress/{batch_id}")
async def get_render_progress(batch_id: str):
    if not job_store.get_job(batch_id):
        raise HTTPException(status_code=404, detail="Batch not found")

    async def stream():
        last_sent_json = None
        idle_count = 0
        while True:
            job = await asyncio.to_thread(job_store.get_job, batch_id)
            batch = job["state"] if job else None
            if not batch:
                break
            batch_json = json.dumps(batch)
            if batch_json != last_sent_json:
                yield f"data: {batch_json}\n\n"
                last_sent_json = batch_json
                idle_count = 0
            else:
                idle_count += 1
                # Send SSE keep-alive comment every 5 iterations (~2.5s) to prevent client/proxy timeout during lag
                if idle_count % 5 == 0:
                    yield ": keep-alive\n\n"
            if batch.get("overall_status") in ["completed", "error", "cancelled"]:
                # Yield final state once and break
                yield f"data: {batch_json}\n\n"
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.get("/api/download-rendered/{file_name}")
def download_rendered_file(file_name: str, title: Optional[str] = None):
    safe_name = os.path.basename(file_name)
    file_path = EXPORTS_DIR / safe_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Rendered clip not found")

    # If title provided, sanitize and use as download filename
    dl_filename = safe_name
    if title and title.strip():
        clean_title = re.sub(r'[\\/*?:"<>|]', "", title.strip())
        if clean_title:
            dl_filename = f"{clean_title}.mp4" if not clean_title.lower().endswith(".mp4") else clean_title

    return FileResponse(file_path, media_type="video/mp4", filename=dl_filename)


@router.get("/api/download-batch-zip/{batch_id}")
def download_batch_zip(batch_id: str):
    clean_id = os.path.basename(batch_id)
    safe_name = f"cheat_clip_pro_{clean_id}.zip"
    file_path = EXPORTS_DIR / safe_name
    if not file_path.exists():
        # Attempt to package any completed clips for this batch on the fly
        persisted = job_store.get_job(batch_id)
        job = persisted["state"] if persisted else None
        if job and job.get("clips"):
            try:
                title_counts: Dict[str, int] = {}
                with zipfile.ZipFile(file_path, "w", zipfile.ZIP_DEFLATED) as zipf:
                    for c in job["clips"]:
                        c_out = c.get("output_path")
                        if not c_out and c.get("download_url"):
                            fname = c["download_url"].split("/")[-1]
                            c_out = str(EXPORTS_DIR / fname)
                        if c_out and os.path.exists(c_out):
                            raw_title = (c.get("title") or "").strip()
                            clean_title = re.sub(r'[\\/*?:"<>|]', "", raw_title) or os.path.splitext(os.path.basename(c_out))[0]
                            count = title_counts.get(clean_title, 0)
                            title_counts[clean_title] = count + 1
                            arc_name = f"{clean_title}.mp4" if count == 0 else f"{clean_title} ({count}).mp4"
                            zipf.write(c_out, arcname=arc_name)
            except Exception as e:
                logger.error(f"Error packaging batch zip on the fly: {e}")
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Batch zip file not found")
    return FileResponse(file_path, media_type="application/zip", filename=safe_name)


@router.get("/api/hardware-accel")
def get_hardware_acceleration_status():
    """Returns detected GPU/CPU hardware acceleration options and recommendations."""
    support = detect_hardware_support()
    rec = support.get("recommended", "cpu")
    gpu_name = support.get("gpu_name")
    nvenc_sub = f"{gpu_name} (NVENC)" if (gpu_name and "geforce" in gpu_name.lower() or "rtx" in (gpu_name or "").lower() or "gtx" in (gpu_name or "").lower() or "nvidia" in (gpu_name or "").lower()) else "GeForce & RTX Hardware Acceleration"
    return {
        "status": "success",
        "active_default": ACTIVE_ENCODER_NAME,
        "recommended": rec,
        "gpu_name": gpu_name,
        "support": support,
        "options": [
            {
                "id": "auto",
                "label": "Auto Detect",
                "sub": f"Recommended ({rec.upper()})",
                "available": True,
            },
            {
                "id": "nvenc",
                "label": "NVIDIA NVENC",
                "sub": nvenc_sub,
                "available": support.get("nvenc", False),
            },
            {
                "id": "amf",
                "label": "AMD AMF",
                "sub": "Radeon RX & APU Hardware Acceleration",
                "available": support.get("amf", False),
            },
            {
                "id": "qsv",
                "label": "Intel QuickSync",
                "sub": "Intel Arc & UHD Hardware Acceleration",
                "available": support.get("qsv", False),
            },
            {
                "id": "cpu",
                "label": "CPU Software (libx264)",
                "sub": "Multi-threaded CPU (100% Universal)",
                "available": True,
            },
        ],
    }

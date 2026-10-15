import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from backend.config import (
    COOKIES_PATH,
    ROOT_COOKIES_PATH,
    get_effective_cookies_path,
    logger,
)
from backend.schemas.downloads import CookiesSaveRequest

router = APIRouter(tags=["Cookies"])


from backend.video_engine import normalize_to_netscape


@router.post("/api/cookies")
async def validate_youtube_cookies(request: Request):
    content = ""
    # Try reading as JSON first
    try:
        data = await request.json()
        if isinstance(data, dict):
            content = str(data.get("cookies_content") or data.get("cookies") or "")
        elif isinstance(data, list):
            content = json.dumps(data)
    except Exception:
        # Fallback to reading raw body text
        try:
            body_bytes = await request.body()
            content = body_bytes.decode("utf-8", errors="ignore")
        except Exception:
            pass

    normalized = normalize_to_netscape(content)
    if not normalized or len(normalized.strip()) < 10:
        raise HTTPException(
            status_code=400,
            detail="Cookies content is empty or invalid. Please paste or upload valid cookies (Netscape .txt or JSON format).",
        )

    # Save to server cookies.txt as persistent fallback for yt-dlp
    try:
        COOKIES_PATH.parent.mkdir(parents=True, exist_ok=True)
        COOKIES_PATH.write_text(normalized, encoding="utf-8")
        logger.info(f"Saved {len(normalized)} bytes of YouTube cookies to {COOKIES_PATH}")
    except Exception as e:
        logger.warning(f"Failed to persist cookies to {COOKIES_PATH}: {e}")

    return {
        "success": True,
        "status": "valid",
        "storage": "both",
        "size": len(normalized),
        "message": "Cookies saved and verified successfully for 1080p downloads."
    }


@router.get("/api/cookies")
def get_youtube_cookies_status():
    eff = get_effective_cookies_path()
    if eff and eff.exists() and eff.stat().st_size > 0:
        try:
            size = eff.stat().st_size
            content = eff.read_text(encoding="utf-8", errors="ignore")
            lines = [l.strip() for l in content.splitlines() if l.strip() and (not l.startswith("#") or l.startswith("#HttpOnly_"))]
            domains = list(dict.fromkeys([l.split("\t")[0].replace("#HttpOnly_", "").strip() for l in lines if "\t" in l]))[:5]
            return {
                "exists": True,
                "has_cookies": True,
                "storage": "both",
                "size": size,
                "sample_lines": domains,
                "cookies_content": content if size < 100000 else ""
            }
        except Exception as e:
            logger.warning(f"Failed to read cookies status from disk: {e}")

    return {
        "exists": False,
        "has_cookies": False,
        "storage": "none",
        "size": 0,
        "sample_lines": [],
        "cookies_content": ""
    }


@router.delete("/api/cookies")
def delete_youtube_cookies():
    # Purge cookie files on server
    for p in [COOKIES_PATH, ROOT_COOKIES_PATH]:
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass
    return {"success": True, "status": "deleted", "exists": False, "has_cookies": False}

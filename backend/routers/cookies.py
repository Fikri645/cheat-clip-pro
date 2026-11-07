import asyncio
import ipaddress
from urllib.parse import urlsplit
from pydantic import BaseModel, Field
import json
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

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

    # Ensure server remains stateless: do NOT write cookies to disk!
    # Purge any legacy cookie files on server for user privacy.
    for p in [COOKIES_PATH, ROOT_COOKIES_PATH]:
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass

    return {
        "success": True,
        "status": "valid",
        "storage": "localStorage",
        "size": len(normalized),
        "message": "Cookies validated successfully. Stored securely in your browser's LocalStorage only."
    }


@router.get("/api/cookies")
def get_youtube_cookies_status():
    # Server is strictly stateless; cookies are stored only in client's LocalStorage
    for p in [COOKIES_PATH, ROOT_COOKIES_PATH]:
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass

    return {
        "exists": False,
        "has_cookies": False,
        "storage": "localStorage",
        "size": 0,
        "sample_lines": [],
        "cookies_content": ""
    }


@router.delete("/api/cookies")
def delete_youtube_cookies():
    # Purge any legacy cookie files on server
    for p in [COOKIES_PATH, ROOT_COOKIES_PATH]:
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass
    return {"success": True, "status": "deleted", "exists": False, "has_cookies": False, "storage": "localStorage"}


class ZenImportRequest(BaseModel):
    profile_id: str = Field(min_length=20, max_length=20, pattern="^[a-f0-9]+$")


def require_local_browser_access(request: Request):
    host = request.client.host if request.client else ""
    try:
        local = ipaddress.ip_address(host).is_loopback
    except ValueError:
        local = host == "localhost"
    if not local:
        raise HTTPException(status_code=403, detail="Browser cookies can only be read on this computer.")
    origin = request.headers.get("origin")
    if origin:
        parsed = urlsplit(origin)
        if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise HTTPException(status_code=403, detail="Only the local app can request browser cookies.")


@router.get("/api/cookies/zen/profiles")
def zen_profiles(request: Request):
    require_local_browser_access(request)
    from backend.services.zen_cookies import discover_profiles
    try:
        profiles = discover_profiles()
    except Exception:
        raise HTTPException(status_code=503, detail="Could not read Zen profiles. Open Zen and try again.")
    return {"profiles": [{key: profile[key] for key in ("id", "name", "default")} for profile in profiles]}


@router.post("/api/cookies/zen/import")
async def import_zen_cookies(body: ZenImportRequest, request: Request):
    require_local_browser_access(request)
    from backend.services.zen_cookies import import_youtube_cookies
    try:
        result = await asyncio.to_thread(import_youtube_cookies, body.profile_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=503, detail="Could not read Zen cookies. Open Zen, sign in to YouTube, and try again.")
    return JSONResponse(result, headers={"Cache-Control": "no-store", "Pragma": "no-cache"})

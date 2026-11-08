"""Reuse a prepared source range while preserving later trim/extend edits."""
import math
import shutil
from pathlib import Path
from urllib.parse import unquote


def prepared_source(clip):
    from backend.config import TEMP_DIR,EXPORTS_DIR,UPLOADS_DIR,is_valid_mp4,get_video_file_metadata
    url=clip.get("source_clip_url") or ""
    if not url.startswith("/api/video/"):return None
    name=unquote(url[len("/api/video/"):])
    if not name or Path(name).name!=name or "\\" in name or "?" in name:return None
    try:
        original_start=float(clip["source_clip_start_time"]);original_end=float(clip["source_clip_end_time"])
        start=float(clip["start_time"]);end=float(clip["end_time"])
    except (KeyError,TypeError,ValueError):return None
    if not all(math.isfinite(value) for value in (original_start,original_end,start,end)):return None
    if original_start<0 or start<original_start or end>original_end or end<=start:return None
    for root in (TEMP_DIR,EXPORTS_DIR,UPLOADS_DIR):
        source=root/name
        if source.is_file() and source.resolve().is_relative_to(root.resolve()) and is_valid_mp4(source):
            duration=get_video_file_metadata(source).get("duration",0)
            if end-original_start<=duration+.25:return source,start-original_start,duration
    return None


def acquire_render_source(clip,target_url,filename,cookies=None):
    from backend.config import TEMP_DIR,download_clip_segment
    from backend.media_lifecycle import media_lease
    source=prepared_source(clip)
    if source:
        path,offset,duration=source
        requested=float(clip["end_time"])-float(clip["start_time"])
        if offset<.001 and abs(requested-duration)<.25:
            output=TEMP_DIR/filename
            with media_lease(path,output):shutil.copyfile(path,output)
            return str(output)
        return download_clip_segment("/api/video/"+path.name,offset,offset+requested,filename,cookies)
    return download_clip_segment(target_url,float(clip["start_time"]),float(clip["end_time"]),filename,cookies)

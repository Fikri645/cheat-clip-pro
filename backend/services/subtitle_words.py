"""Acoustic word timings without downloading or encoding an HD video clip."""
import hashlib
import json
import math
import re
import subprocess
import time
from urllib.parse import unquote, urlsplit

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

from backend.services.render_cache import read_cached, source_identity, word_cache, word_identity


class SubtitleWordsRequest(BaseModel):
    video_id: str = Field(min_length=1, max_length=240, pattern=r"^[\w-]+$")
    audio_source: str = Field(default="", max_length=2048)
    start_time: float = Field(ge=0, allow_inf_nan=False)
    end_time: float = Field(gt=0, allow_inf_nan=False)
    transcript: list[dict] = Field(default_factory=list, max_length=30000)
    cookies: str | None = Field(default=None, repr=False, max_length=1000000)

    @model_validator(mode="after")
    def ordered_range(self):
        if self.end_time <= self.start_time:
            raise ValueError("Clip end must be later than start")
        return self


def local_source(request):
    from backend.config import TEMP_DIR, UPLOADS_DIR, EXPORTS_DIR
    roots = (UPLOADS_DIR, TEMP_DIR, EXPORTS_DIR)
    if request.video_id.startswith(("upload_", "gdrive_")):
        name = unquote(urlsplit(request.audio_source).path).replace("\\", "/").split("/")[-1]
        for root in roots:
            for candidate in (root / name, *root.glob(request.video_id + ".*")):
                if candidate.is_file() and candidate.resolve().is_relative_to(root.resolve()):
                    return candidate
        raise HTTPException(404, "Original uploaded audio/video is no longer available")
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", request.video_id):
        raise HTTPException(422, "Invalid YouTube video ID")
    # Reuse the full audio from analysis, if cleanup has not expired it yet.
    for root in roots:
        for candidate in root.glob(f"yt_audio_{request.video_id}.*"):
            if candidate.suffix.lower() in {".mp4", ".m4a", ".webm", ".opus", ".ogg", ".mp3", ".wav"} and candidate.stat().st_size > 10000:
                if candidate.resolve().is_relative_to(root.resolve()):
                    return candidate
    return None


_streams = {}


def run_media_command(command, *, timeout, text=False):
    from backend.services.process_control import terminate_tree
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=text)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        # Windows launcher executables can own a second Python/FFmpeg process.
        terminate_tree(process.pid)
        process.communicate()
        raise
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def audio_stream(video_id, cookies, cookie_path, *, refresh=False):
    """Reuse short-lived extraction metadata between clips, never store credentials."""
    from backend.video_engine import get_yt_dlp_base_cmd, normalize_to_netscape
    key = (video_id, hashlib.sha256((cookies or "").encode()).hexdigest())
    if not refresh and key in _streams and _streams[key][0] > time.monotonic():
        return _streams[key][1]
    if cookies:
        cookie_path.write_text(normalize_to_netscape(cookies), encoding="utf-8")
    try:
        attempts = [True, False] if cookies else [True]
        for include_cookies in attempts:
            command = [*get_yt_dlp_base_cmd(include_cookies=include_cookies,
                cookies_path=cookie_path if cookies and include_cookies else None),
                "--no-playlist", "--no-warnings", "--socket-timeout", "15", "--retries", "2",
                "-f", "bestaudio", "--dump-single-json", f"https://www.youtube.com/watch?v={video_id}"]
            try:
                response = run_media_command(command, text=True, timeout=90)
            except subprocess.TimeoutExpired:
                continue
            if response.returncode:
                continue
            info = json.loads(response.stdout)
            stream = info.get("url", "")
            if not stream.startswith("https://"):
                continue
            value = {"url": stream, "headers": info.get("http_headers") or {}}
            # A bounded per-worker cache of signed URLs, not a file or database.
            if len(_streams) >= 16:
                _streams.pop(next(iter(_streams)))
            _streams[key] = (time.monotonic() + 240, value)
            return value
    finally:
        cookie_path.unlink(missing_ok=True)
    raise HTTPException(502, "Could not open the YouTube audio stream. Check cookies and try again.")


def extract_audio(request, source, output, cookie_path):
    """Accurately seek and decode only the requested speech range at 16 kHz."""
    for attempt in range(2 if source is None else 1):
        extra = []
        if source is None:
            stream = audio_stream(request.video_id, request.cookies, cookie_path, refresh=attempt > 0)
            source_url = stream["url"]
            headers = "".join(f"{name}: {value}\r\n" for name, value in stream["headers"].items()
                              if "\r" not in str(name) + str(value) and "\n" not in str(name) + str(value))
            extra = ["-rw_timeout", "20000000"]
            if headers:
                extra += ["-headers", headers]
        else:
            source_url = str(source)
        command = ["ffmpeg", "-y", "-v", "error", *extra, "-ss", str(request.start_time), "-i", source_url,
                   "-t", str(request.end_time-request.start_time), "-vn", "-ar", "16000", "-ac", "1", str(output)]
        try:
            result = run_media_command(command, timeout=max(120, request.end_time-request.start_time+60))
        except subprocess.TimeoutExpired:
            # The raw exception contains signed URLs and HTTP headers.
            raise HTTPException(504, "Reading clip audio timed out. Try loading it again.") from None
        if result.returncode == 0 and output.is_file() and output.stat().st_size > 44:
            return
    raise HTTPException(502, "Could not read audio for this clip. Try loading it again.")


def previous_words(request, source, language):
    from backend.config import EXPORTS_DIR
    candidates = [source] if source else []
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", request.video_id):
        candidates += list(EXPORTS_DIR.glob(f"source_*_{request.video_id}_clip_{int(request.start_time)}_{int(request.end_time)}_*_raw.mp4"))
    for candidate in candidates:
        try:
            # The filename only narrows candidates. An exact cache-key match
            # proves the content, fractional range, transcript and model match.
            identity = word_identity(source_identity(candidate), request.start_time, request.end_time, request.transcript, language)
            words = read_cached("words-v1", identity)
            if words is not None:
                return words
        except FileNotFoundError:
            continue  # Cleanup may have removed an old raw clip.
    return None


def prepare_subtitle_words(payload, task_id):
    from backend.config import TEMP_DIR
    from backend.media_lifecycle import media_lease
    from backend.video_engine import _transcribe_clip_words_uncached
    from backend.utils.text import detect_transcript_language
    request = SubtitleWordsRequest.model_validate(payload)
    source = local_source(request)
    identity = source_identity(source) if request.video_id.startswith(("upload_", "gdrive_")) else "youtube:" + request.video_id
    language = detect_transcript_language(request.transcript[:50]).get("code") if request.transcript else None
    if language not in {"en", "id"}:
        language = None
    output = TEMP_DIR / f"subtitle_job_{task_id}.wav"
    cookie_path = TEMP_DIR / f"subtitle_job_{task_id}.cookies.txt"
    def compute():
        with media_lease(source, output, cookie_path):
            try:
                original = previous_words(request, source, language)
                if original is None:
                    extract_audio(request, source, output, cookie_path)
                    original = _transcribe_clip_words_uncached(str(output), request.transcript, request.start_time, request.end_time, language)
                words = []
                end = 0.0
                for item in original:
                    raw_start, raw_end = float(item["start"]), float(item["end"])
                    if not math.isfinite(raw_start) or not math.isfinite(raw_end):
                        continue
                    start = max(end, raw_start, 0)
                    finish = min(request.end_time-request.start_time, raw_end)
                    if finish > start and item["word"].strip():
                        words.append({"word": item["word"], "start": start, "end": finish})
                        end = finish
                return words
            finally:
                output.unlink(missing_ok=True)
                cookie_path.unlink(missing_ok=True)
    # The lookup happens before any network request or model loading. Includes
    # source/range/transcript/language/model; styling and cookies are not words.
    return {"words": word_cache(identity, request.start_time, request.end_time, request.transcript, language, compute)}

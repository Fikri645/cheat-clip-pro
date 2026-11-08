"""Fast YouTube section downloads.

ffmpeg reading a googlevideo URL opens one long-lived connection, which YouTube
throttles to roughly playback speed (~0.5 MB/s). Short ranged requests are
served at full line speed, so instead we:

1. resolve the DASH stream URLs once per video (cached until they expire),
2. read each stream's ``sidx`` index to map the clip's time range to bytes,
3. fetch only those fragments with parallel ranged requests, and
4. cut the exact range locally with the selected (GPU) encoder.
"""
import json
import logging
import struct
import subprocess
import threading
import time
import http.client
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Prefer the largest resolution <= 1080p, then H.264 video and AAC audio: both are
# fragmented MP4 with a sidx index and decode quickly on any machine.
FORMAT_SORT = "res:1080,vcodec:h264,acodec:m4a"
FORMAT_SELECTOR = "bv*+ba/b"

CHUNK_BYTES = 8 << 20
PARALLEL_REQUESTS = 6
HEAD_BYTES = 256 << 10
URL_EXPIRY_MARGIN = 600

_CACHE: Dict[Tuple[str, bool], Tuple[List[dict], float]] = {}
_CACHE_LOCK = threading.Lock()


class SectionUnsupported(RuntimeError):
    """The resolved formats can't be fetched by range; use the legacy path."""


# ---------------------------------------------------------------- stream resolution

def _url_expiry(url: str) -> float:
    try:
        return float(urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["expire"][0])
    except (KeyError, ValueError, IndexError):
        return time.time() + 3600


def resolve_streams(clean_url: str, base_cmd: List[str], use_cookies: bool, timeout: int = 90) -> List[dict]:
    """Returns yt-dlp's requested formats (url, ext, http_headers...), cached per video."""
    key = (clean_url, use_cookies)
    with _CACHE_LOCK:
        cached = _CACHE.get(key)
        if cached and time.time() < cached[1]:
            return cached[0]

    cmd = [*base_cmd, "-S", FORMAT_SORT, "-f", FORMAT_SELECTOR, "--socket-timeout", "20",
           "--print", "%(requested_formats)j", "--no-warnings", clean_url]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    if res.returncode != 0:
        raise RuntimeError((res.stderr or "yt-dlp failed to resolve stream URLs").strip()[:300])
    line = (res.stdout or "").strip().splitlines()[-1:] or ["NA"]
    if line[0] in ("NA", "null", ""):
        raise SectionUnsupported("Video has no separate audio/video streams")
    formats = json.loads(line[0])
    if not isinstance(formats, list) or len(formats) != 2:
        raise SectionUnsupported("Unexpected stream layout")

    expires = min(_url_expiry(f["url"]) for f in formats) - URL_EXPIRY_MARGIN
    with _CACHE_LOCK:
        _CACHE[key] = (formats, expires)
    logger.info("Resolved YouTube streams for %s: %s", clean_url,
                " + ".join(f"{f.get('format_id')} ({f.get('vcodec') if f.get('vcodec') != 'none' else f.get('acodec')})" for f in formats))
    return formats


def invalidate(clean_url: str, use_cookies: bool) -> None:
    with _CACHE_LOCK:
        _CACHE.pop((clean_url, use_cookies), None)


# ---------------------------------------------------------------- ranged HTTP

class _IPv4HTTPSConnection(http.client.HTTPSConnection):
    """googlevideo URLs are bound to the IPv4 address yt-dlp resolved them with."""

    def connect(self):
        self.source_address = ("0.0.0.0", 0)
        super().connect()


def fetch_range(url: str, start: int, end: int, headers: dict, retries: int = 4) -> bytes:
    """Fetches bytes [start, end] (inclusive) using YouTube's ``range`` query parameter."""
    expected = end - start + 1
    last_error: Optional[Exception] = None
    for attempt in range(retries):
        target = f"{url}&range={start}-{end}"
        try:
            for _ in range(4):  # follow redirects
                parts = urllib.parse.urlsplit(target)
                conn = _IPv4HTTPSConnection(parts.netloc, timeout=30)
                try:
                    conn.request("GET", f"{parts.path}?{parts.query}", headers=headers)
                    resp = conn.getresponse()
                    if resp.status in (301, 302, 303, 307, 308) and resp.getheader("Location"):
                        target = urllib.parse.urljoin(target, resp.getheader("Location"))
                        resp.read()
                        continue
                    data = resp.read()
                finally:
                    conn.close()
                if resp.status not in (200, 206):
                    raise RuntimeError(f"HTTP {resp.status}")
                if len(data) != expected:
                    raise RuntimeError(f"short read {len(data)}/{expected}")
                return data
            raise RuntimeError("too many redirects")
        except Exception as exc:  # network blips are common; retry with backoff
            last_error = exc
            if "HTTP 403" in str(exc) or "HTTP 410" in str(exc):
                break
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"Range download failed ({last_error})")


# ---------------------------------------------------------------- MP4 index

def iter_boxes(data: bytes, offset: int = 0):
    while offset + 8 <= len(data):
        size, kind = struct.unpack(">I4s", data[offset:offset + 8])
        header = 8
        if size == 1:
            if offset + 16 > len(data):
                return
            size = struct.unpack(">Q", data[offset + 8:offset + 16])[0]
            header = 16
        if size < header:
            return
        yield kind.decode("latin1"), offset, size, header
        offset += size


def parse_sidx(box: bytes, box_offset: int, header: int) -> List[Tuple[int, int, float, float]]:
    """Returns [(byte_offset, byte_size, start_seconds, duration_seconds)] per fragment."""
    p = header
    version = box[p]
    p += 8  # version/flags + reference_ID
    timescale = struct.unpack(">I", box[p:p + 4])[0]
    p += 4
    if version == 0:
        earliest, first_offset = struct.unpack(">II", box[p:p + 8])
        p += 8
    else:
        earliest, first_offset = struct.unpack(">QQ", box[p:p + 16])
        p += 16
    p += 2  # reserved
    count = struct.unpack(">H", box[p:p + 2])[0]
    p += 2
    refs = []
    pos = box_offset + len(box) + first_offset
    t = earliest
    for _ in range(count):
        ref_size, duration, _sap = struct.unpack(">III", box[p:p + 12])
        p += 12
        if ref_size & 0x80000000:
            raise SectionUnsupported("Hierarchical sidx is not supported")
        refs.append((pos, ref_size, t / timescale, duration / timescale))
        pos += ref_size
        t += duration
    return refs


def read_index(fmt: dict) -> Tuple[int, List[Tuple[int, int, float, float]]]:
    """Returns (init_size, fragments) for a fragmented MP4 stream."""
    if fmt.get("ext") not in ("mp4", "m4a") or not str(fmt.get("protocol", "https")).startswith("http"):
        raise SectionUnsupported(f"Format {fmt.get('format_id')} ({fmt.get('ext')}) has no MP4 index")
    url, headers = fmt["url"], fmt.get("http_headers") or {}
    head = fetch_range(url, 0, HEAD_BYTES - 1, headers) if (fmt.get("filesize") or HEAD_BYTES + 1) > HEAD_BYTES \
        else fetch_range(url, 0, int(fmt["filesize"]) - 1, headers)
    for kind, offset, size, header in iter_boxes(head):
        if kind == "sidx":
            if offset + size > len(head):
                head += fetch_range(url, len(head), offset + size - 1, headers)
            return offset, parse_sidx(head[offset:offset + size], offset, header)
        if kind in ("moof", "mdat"):
            break
    raise SectionUnsupported(f"Format {fmt.get('format_id')} has no sidx index")


def select_fragments(refs, start: float, end: float):
    chosen = [r for r in refs if r[2] + r[3] > start and r[2] < end]
    if not chosen:
        raise RuntimeError(f"Requested range {start:.2f}-{end:.2f}s is outside the stream")
    return chosen


def timeline_offset(part: Path, fragment_start: float) -> float:
    """How far the demuxed timestamps sit from the sidx timeline.

    ffmpeg ignores the edit list for fragmented MP4, so a full download would start at
    the first fragment's composition offset (e.g. the B-frame delay) rather than 0.
    ``ffmpeg -ss t`` on that full file seeks to ``t + start_time``; we reproduce that
    exactly by measuring the offset on the fragments we fetched.
    """
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "0", "-show_entries", "packet=pts_time",
         "-read_intervals", "%+#24", "-of", "csv=p=0", str(part)],
        capture_output=True, text=True, timeout=30,
    ).stdout
    pts = [float(x) for x in out.split() if x.strip() not in ("", "N/A")]
    if not pts:
        raise RuntimeError(f"Could not read timestamps from {part.name}")
    return min(pts) - fragment_start


def download_stream_section(fmt: dict, start: float, end: float, dest: Path) -> float:
    """Downloads the fragments covering [start, end] to ``dest``; returns the timeline offset."""
    url, headers = fmt["url"], fmt.get("http_headers") or {}
    init_size, refs = read_index(fmt)
    chosen = select_fragments(refs, start, end)
    first, last = chosen[0][0], chosen[-1][0] + chosen[-1][1] - 1
    spans = [(0, init_size - 1)] + [(a, min(last, a + CHUNK_BYTES - 1)) for a in range(first, last + 1, CHUNK_BYTES)]
    with ThreadPoolExecutor(PARALLEL_REQUESTS) as pool:
        chunks = list(pool.map(lambda s: fetch_range(url, s[0], s[1], headers), spans))
    with open(dest, "wb") as fh:
        for chunk in chunks:
            fh.write(chunk)
    return timeline_offset(dest, chosen[0][2])


# ---------------------------------------------------------------- public entry point

def download_section(
    formats: List[dict],
    start: float,
    end: float,
    output_path: Path,
    encoder_args: List[str],
    fallback_encoder_args: Optional[List[str]] = None,
    timeout: int = 900,
    av1_decoder_args: Optional[List[str]] = None,
) -> None:
    """Writes an exact [start, end] cut of a YouTube video to ``output_path``."""
    video = next((f for f in formats if f.get("vcodec") not in (None, "none")), None)
    audio = next((f for f in formats if f is not video and f.get("acodec") not in (None, "none")), None)
    if not video:
        raise SectionUnsupported("No video stream")

    parts: List[Path] = []
    t0 = time.time()
    try:
        jobs = [(video, output_path.with_name(output_path.stem + ".v.mp4"))]
        if audio:
            jobs.append((audio, output_path.with_name(output_path.stem + ".a.m4a")))
        with ThreadPoolExecutor(len(jobs)) as pool:
            offsets = list(pool.map(lambda j: download_stream_section(j[0], start, end, j[1]), jobs))
        parts = [p for _, p in jobs]
        fetched = sum(p.stat().st_size for p in parts)
        t1 = time.time()

        decoder_args = av1_decoder_args if str(video.get("vcodec", "")).startswith("av01") and av1_decoder_args else []

        def encode(args: List[str], video_decoder: List[str]):
            # Fragments keep their absolute timestamps, so seek by timestamp (plus the
            # stream's timeline offset) rather than from the file start. Don't add
            # -avoid_negative_ts: it shifts the streams and breaks frame alignment.
            cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
            for i, (p, offset) in enumerate(zip(parts, offsets)):
                cmd += [*(video_decoder if i == 0 else []), "-seek_timestamp", "1",
                        "-ss", f"{start + offset:.6f}", "-i", str(p)]
            cmd += ["-t", f"{end - start:.3f}", "-map", "0:v:0"]
            if audio:
                cmd += ["-map", "1:a:0"]
            cmd += [*args, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output_path)]
            return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)

        res = encode(encoder_args, decoder_args)
        if res.returncode != 0 and (decoder_args or (fallback_encoder_args and fallback_encoder_args != encoder_args)):
            logger.warning("GPU slice encode failed (%s); retrying on CPU", (res.stderr or "").strip()[:200])
            res = encode(fallback_encoder_args or encoder_args, [])
        if res.returncode != 0:
            raise RuntimeError((res.stderr or "ffmpeg failed to cut the section").strip()[:300])
        logger.info("Ranged section %.1fs: fetched %.1f MB in %.1fs, cut in %.1fs",
                    end - start, fetched / 1e6, t1 - t0, time.time() - t1)
    finally:
        for p in parts or [output_path.with_name(output_path.stem + s) for s in (".v.mp4", ".a.m4a")]:
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass

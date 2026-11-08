"""Ranged YouTube section downloads: index parsing, URL caching, exact cuts, prefetch."""
import asyncio
import json
import shutil
import struct
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.services import youtube_sections as ys


def make_sidx(timescale, earliest, sizes_and_durations, version=0):
    body = struct.pack(">I", 1) + struct.pack(">I", timescale)
    body += struct.pack(">II", earliest, 0) if version == 0 else struct.pack(">QQ", earliest, 0)
    body += struct.pack(">HH", 0, len(sizes_and_durations))
    for size, dur in sizes_and_durations:
        body += struct.pack(">III", size, dur, 0x90000000)
    payload = bytes([version, 0, 0, 0]) + body
    return struct.pack(">I4s", 8 + len(payload), b"sidx") + payload


def test_sidx_maps_time_to_byte_ranges_and_selects_overlapping_fragments():
    box = make_sidx(1000, 2000, [(100, 5000), (200, 5000), (300, 5000)], version=1)
    refs = ys.parse_sidx(box, 40, 8)
    end_of_box = 40 + len(box)
    assert refs == [(end_of_box, 100, 2.0, 5.0), (end_of_box + 100, 200, 7.0, 5.0), (end_of_box + 300, 300, 12.0, 5.0)]
    assert ys.select_fragments(refs, 7.5, 12.0) == [refs[1]]
    assert ys.select_fragments(refs, 6.9, 12.1) == refs
    with pytest.raises(RuntimeError):
        ys.select_fragments(refs, 30, 40)


def test_read_index_finds_sidx_and_init_size(monkeypatch):
    head = struct.pack(">I4s", 16, b"ftyp") + b"\0" * 8 + struct.pack(">I4s", 24, b"moov") + b"\0" * 16
    sidx = make_sidx(30000, 0, [(1000, 30000)])
    data = head + sidx + struct.pack(">I4s", 8, b"moof")
    monkeypatch.setattr(ys, "fetch_range", lambda url, a, b, h: data[a:b + 1])
    init, refs = ys.read_index({"ext": "mp4", "url": "u", "filesize": 10 << 20})
    assert init == len(head)
    assert refs == [(len(head) + len(sidx), 1000, 0.0, 1.0)]
    with pytest.raises(ys.SectionUnsupported):
        ys.read_index({"ext": "webm", "url": "u"})


def test_stream_urls_are_resolved_once_until_they_expire(monkeypatch):
    ys._CACHE.clear()
    calls = []
    expire = [time.time() + 7200]

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        fmts = [{"url": f"https://x/v?expire={int(expire[0])}", "ext": "mp4", "vcodec": "avc1", "acodec": "none"},
                {"url": f"https://x/a?expire={int(expire[0])}", "ext": "m4a", "vcodec": "none", "acodec": "mp4a"}]
        return SimpleNamespace(returncode=0, stdout=json.dumps(fmts) + "\n", stderr="")

    monkeypatch.setattr(ys.subprocess, "run", fake_run)
    a = ys.resolve_streams("https://youtube.com/watch?v=x", ["yt-dlp"], False)
    b = ys.resolve_streams("https://youtube.com/watch?v=x", ["yt-dlp"], False)
    assert a is b and len(calls) == 1
    ys.resolve_streams("https://youtube.com/watch?v=x", ["yt-dlp"], True)
    assert len(calls) == 2  # cookie mode is cached separately
    ys.invalidate("https://youtube.com/watch?v=x", False)
    expire[0] = time.time() + 60  # expires within the safety margin -> never cached as valid
    ys.resolve_streams("https://youtube.com/watch?v=x", ["yt-dlp"], False)
    ys.resolve_streams("https://youtube.com/watch?v=x", ["yt-dlp"], False)
    assert len(calls) == 4

    monkeypatch.setattr(ys.subprocess, "run", lambda cmd, **k: SimpleNamespace(returncode=0, stdout="NA\n", stderr=""))
    with pytest.raises(ys.SectionUnsupported):
        ys.resolve_streams("https://youtube.com/watch?v=progressive", ["yt-dlp"], False)
    ys._CACHE.clear()


def probe(path, entries):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", entries, "-of", "json", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="Requires FFmpeg")
def test_ranged_cut_is_frame_identical_to_a_direct_cut(tmp_path, monkeypatch):
    video, audio = tmp_path / "video.mp4", tmp_path / "audio.m4a"
    # YouTube-like DASH files: fragmented MP4 with a global sidx at the start.
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=40",
                    "-c:v", "libx264", "-preset", "ultrafast", "-g", "60", "-bf", "2",
                    "-movflags", "+dash+global_sidx", str(video)], check=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=40",
                    "-c:a", "aac", "-movflags", "+dash+global_sidx", str(audio)], check=True)
    files = {"v": video.read_bytes(), "a": audio.read_bytes()}
    fetched = []

    def fake_fetch(url, a, b, headers):
        fetched.append((url, a, b))
        return files[url][a:b + 1]

    monkeypatch.setattr(ys, "fetch_range", fake_fetch)
    formats = [{"url": "v", "ext": "mp4", "vcodec": "avc1", "acodec": "none", "filesize": len(files["v"])},
               {"url": "a", "ext": "m4a", "vcodec": "none", "acodec": "mp4a", "filesize": len(files["a"])}]
    out = tmp_path / "clip.mp4"
    x264 = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "10"]
    ys.download_section(formats, 13.37, 20.0, out, x264)

    fetched_video = sum(b - a + 1 for url, a, b in fetched if url == "v")
    assert fetched_video < len(files["v"]) * 0.4  # only the needed fragments were downloaded
    assert not list(tmp_path.glob("clip.*.m*"))  # temporary fragment files removed

    reference = tmp_path / "reference.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", "13.37", "-i", str(video), "-ss", "13.37", "-i", str(audio),
                    "-t", "6.63", "-map", "0:v", "-map", "1:a", *x264, "-c:a", "aac", str(reference)], check=True)
    got = probe(out, "stream=codec_type,start_time,nb_frames")["streams"]
    ref = probe(reference, "stream=start_time,nb_frames")["streams"]
    assert [s["codec_type"] for s in got] == ["video", "audio"]
    assert abs(float(got[0]["start_time"]) - float(ref[0]["start_time"])) < 0.001
    assert abs(float(got[1]["start_time"]) - float(ref[1]["start_time"])) < 0.001
    assert got[0]["nb_frames"] == ref[0]["nb_frames"]
    psnr = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(reference), "-i", str(out), "-lavfi", "[0:v][1:v]psnr", "-f", "null", "-"],
                          capture_output=True, text=True).stderr
    average = psnr.split("average:")[1].split()[0]
    assert average == "inf" or float(average) > 40, psnr


def test_batch_prefetches_next_source_while_current_clip_renders(monkeypatch):
    from backend.services import render_service as rs
    events = []

    async def fake_source(batch_id, idx, clip, settings, target_url, cookies_content=None):
        events.append(("download-start", idx))
        await asyncio.sleep(0.05)
        events.append(("download-end", idx))
        return f"art{idx}", f"raw{idx}"

    async def fake_render(*, idx, source_task, **kwargs):
        assert (await source_task) == (f"art{idx}", f"raw{idx}")
        events.append(("render-start", idx))
        await asyncio.sleep(0.1)
        events.append(("render-end", idx))
        rs.RENDER_BATCHES["b"]["clips"][idx]["status"] = "completed"

    monkeypatch.setattr(rs, "acquire_batch_clip_source", fake_source)
    monkeypatch.setattr(rs, "render_single_batch_clip", fake_render)
    monkeypatch.setattr(rs, "update_batch_summary_and_zip", lambda *a: None)
    rs.RENDER_BATCHES["b"] = {"clips": [{"status": "completed"}, {"status": "pending"}, {"status": "pending"}, {"status": "pending"}]}
    request = SimpleNamespace(clips=[{}, {}, {}, {}], settings=SimpleNamespace(render_mode="separate"),
                              video_url="https://youtube.com/watch?v=abcdefghijk", video_id=None, transcript=None, cookies=None)
    try:
        asyncio.run(rs.process_batch_rendering("b", request))
    finally:
        rs.RENDER_BATCHES.pop("b", None)

    order = {e: i for i, e in enumerate(events)}
    assert ("download-start", 0) not in order  # completed clips are skipped
    for idx in (1, 2):
        # next download starts only after this one finished, and overlaps this clip's render
        assert order[("download-end", idx)] < order[("download-start", idx + 1)] < order[("render-end", idx)]
    assert [e for e in events if e[0] == "render-start"] == [("render-start", 1), ("render-start", 2), ("render-start", 3)]

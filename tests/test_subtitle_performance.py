import asyncio
import os
import time
from types import SimpleNamespace

import psutil
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from backend.services.subtitle_words import SubtitleWordsRequest, audio_stream, extract_audio, prepare_subtitle_words
from backend.services.subtitle_worker import SubtitleWorker


def request(**changes):
    return SubtitleWordsRequest(video_id="abcdefghijk", start_time=12.25, end_time=15.75,
        transcript=[{"text":"Halo dunia", "start":12, "duration":4}], **changes)


def test_cached_words_bypass_audio_and_model_even_after_original_audio_expires(tmp_path, monkeypatch):
    import backend.config as config
    import backend.video_engine as engine
    import backend.services.subtitle_words as service
    monkeypatch.setenv("RENDER_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(config, "TEMP_DIR", tmp_path)
    calls=[]
    source=tmp_path / "yt_audio_abcdefghijk.m4a";source.write_bytes(b"audio")
    monkeypatch.setattr(service,"local_source",lambda req:source if source.exists() else None)
    def extract(req, src, output, cookies):
        calls.append("audio");output.write_bytes(b"PCM")
    monkeypatch.setattr(service,"extract_audio",extract)
    monkeypatch.setattr(engine,"_transcribe_clip_words_uncached",lambda *args:(calls.append("whisper") or [
        {"word":"Halo","start":-.1,"end":1}, {"word":"dunia","start":.5,"end":10}]))
    payload=request().model_dump()
    first=prepare_subtitle_words(payload,"a"*32)
    source.unlink()
    assert prepare_subtitle_words(payload,"b"*32)==first
    assert calls==["audio","whisper"]
    assert first["words"]==[{"word":"Halo","start":0,"end":1},{"word":"dunia","start":1,"end":3.5}]
    assert not list(tmp_path.glob("subtitle_job_*"))
    for changed in [dict(start_time=13),dict(transcript=[{"text":"Changed"}])]:
        prepare_subtitle_words({**payload,**changed},"c"*32)
    monkeypatch.setenv("WHISPER_MODEL","another-model")
    prepare_subtitle_words(payload,"d"*32)
    assert calls.count("whisper")==4


def test_audio_metadata_reused_but_cookie_changes_refresh_it(tmp_path,monkeypatch):
    import backend.services.subtitle_words as service
    service._streams.clear()
    commands=[]
    def run(command,**kwargs):
        commands.append(command)
        return SimpleNamespace(returncode=0,stdout='{"url":"https://audio.example/stream","http_headers":{"User-Agent":"QA"}}')
    monkeypatch.setattr(service,"run_media_command",run)
    monkeypatch.setattr("backend.video_engine.get_yt_dlp_base_cmd",lambda **kwargs:["yt-dlp"])
    cookies=tmp_path/"job.cookies.txt"
    assert audio_stream("abcdefghijk","first",cookies)==audio_stream("abcdefghijk","first",cookies)
    audio_stream("abcdefghijk","second",cookies)
    assert len(commands)==2
    assert all(command[command.index("-f")+1]=="bestaudio" for command in commands)
    assert not cookies.exists()


def test_audio_slice_uses_fractional_seek_and_never_video_encoding(tmp_path,monkeypatch):
    import backend.services.subtitle_words as service
    output=tmp_path/"clip.wav";commands=[]
    monkeypatch.setattr(service,"audio_stream",lambda *args,**kwargs:{"url":"https://audio.example/stream","headers":{}})
    def run(command,**kwargs):
        commands.append(command);output.write_bytes(b"PCM"*100)
        return SimpleNamespace(returncode=0)
    monkeypatch.setattr(service,"run_media_command",run)
    extract_audio(request(),None,output,tmp_path/"cookie")
    command=commands[0]
    assert command[command.index("-ss")+1]=="12.25"
    assert command.index("-ss")<command.index("-i")
    assert command[command.index("-t")+1]=="3.5"
    assert "-vn" in command and "-c:v" not in command


def test_missing_upload_never_uses_unrelated_file_and_ranges_are_validated(tmp_path,monkeypatch):
    import backend.config as config
    for field in ("TEMP_DIR","UPLOADS_DIR","EXPORTS_DIR"):monkeypatch.setattr(config,field,tmp_path)
    (tmp_path/"unrelated.mp4").write_bytes(b"video")
    from backend.services.subtitle_words import local_source
    with pytest.raises(HTTPException) as exc:
        local_source(SubtitleWordsRequest(video_id="upload_missing",audio_source="/api/video/missing.mp4",start_time=0,end_time=2))
    assert exc.value.status_code==404
    with pytest.raises(ValidationError):SubtitleWordsRequest(video_id="abc",start_time=3,end_time=2)
    with pytest.raises(ValidationError):SubtitleWordsRequest(video_id="../escape",start_time=0,end_time=2)


def test_real_audio_slice_keeps_the_requested_duration(tmp_path):
    import shutil
    import wave
    from backend.config import TEMP_DIR  # Ensures the configured FFmpeg is on PATH.
    if not shutil.which("ffmpeg"):pytest.skip("FFmpeg not installed")
    source=tmp_path/"source.wav";output=tmp_path/"slice.wav"
    with wave.open(str(source),"wb") as audio:
        audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(16000)
        audio.writeframes(b"\0\0"*(16000*20))
    extract_audio(request(),source,output,tmp_path/"cookies")
    with wave.open(str(output),"rb") as audio:
        assert audio.getframerate()==16000
        assert audio.getnchannels()==1
        assert audio.getnframes()==56000  # Exactly 3.5 seconds, not the full video.


def test_command_timeout_stops_descendants_and_hides_signed_audio_url(tmp_path,monkeypatch):
    import subprocess
    import backend.services.subtitle_words as service
    stopped=[]
    class Process:
        pid=12345
        calls=0
        def communicate(self,timeout=None):
            self.calls+=1
            if self.calls==1:raise subprocess.TimeoutExpired(["ffmpeg","https://audio.example/?signature=SECRET"],timeout)
            return b"",b""
    monkeypatch.setattr(service.subprocess,"Popen",lambda *args,**kwargs:Process())
    monkeypatch.setattr("backend.services.process_control.terminate_tree",lambda pid:stopped.append(pid))
    monkeypatch.setattr(service,"audio_stream",lambda *args,**kwargs:{"url":"https://audio.example/?signature=SECRET","headers":{}})
    with pytest.raises(HTTPException) as exc:extract_audio(request(),None,tmp_path/"audio.wav",tmp_path/"cookies")
    assert exc.value.status_code==504
    assert "SECRET" not in exc.value.detail
    assert stopped==[12345]


def test_subtitle_endpoint_keeps_clip_range_and_rejects_invalid_input(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    import backend.routers.subtitles as subtitles
    received=[]
    class Worker:
        async def run(self,payload,request):
            received.append(payload)
            return {"words":[{"word":"Halo","start":0,"end":1}]}
    monkeypatch.setattr(subtitles,"subtitle_worker",Worker())
    app=FastAPI();app.include_router(subtitles.router)
    with TestClient(app) as client:
        assert client.post("/api/subtitle-words",json=request().model_dump()).json()["words"][0]["word"]=="Halo"
        assert received[0]["start_time"]==12.25
        assert received[0]["end_time"]==15.75
        assert client.post("/api/subtitle-words",json={**request().model_dump(),"end_time":1}).status_code==422
        assert len(received)==1


def fake_worker(inbox,outbox):
    while True:
        task_id,payload=inbox.get()
        time.sleep(payload.get("delay",0))
        outbox.put((task_id,200,{"pid":os.getpid()}))


class Connection:
    disconnected=False
    async def is_disconnected(self):return self.disconnected


def test_worker_reuses_process_cancels_owned_work_and_survives_disconnected_waiter():
    async def verify():
        worker=SubtitleWorker(target=fake_worker)
        try:
            first=await worker.run({},Connection())
            second=await worker.run({},Connection())
            assert first["pid"]==second["pid"]
            active=asyncio.create_task(worker.run({"delay":.4},Connection()))
            await asyncio.sleep(.1)
            waiter=Connection();waiter.disconnected=True
            with pytest.raises(HTTPException) as exc:await worker.run({},waiter)
            assert exc.value.status_code==499
            assert (await active)["pid"]==first["pid"]
            connection=Connection()
            active=asyncio.create_task(worker.run({"delay":20},connection))
            await asyncio.sleep(.15);connection.disconnected=True
            with pytest.raises(HTTPException) as exc:await active
            assert exc.value.status_code==499
            assert not psutil.pid_exists(first["pid"])
            assert (await worker.run({},Connection()))["pid"]!=first["pid"]
        finally:worker.close()
    asyncio.run(verify())

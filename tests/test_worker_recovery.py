"""Real FFmpeg integration: crash a worker after one clip, then resume the rest."""
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest

from backend.render_worker import start_worker
from backend.services import job_store


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg is needed for video integration")
def test_crashed_worker_resumes_without_encoding_completed_clip(tmp_path, monkeypatch):
    monkeypatch.setenv("JOB_DATABASE_PATH",str(tmp_path/"jobs.sqlite3"))
    from backend.config import UPLOADS_DIR, EXPORTS_DIR, TEMP_DIR
    name="upload_qa_"+uuid.uuid4().hex
    source=UPLOADS_DIR/(name+".mp4")
    batch_id="recovery_"+uuid.uuid4().hex
    subprocess.run(["ffmpeg","-y","-v","error","-f","lavfi","-i","testsrc2=size=640x360:rate=30:duration=4",
                    "-f","lavfi","-i","sine=frequency=440:duration=4","-c:v","libx264","-c:a","aac","-shortest",str(source)],check=True)
    clips=[{"title":"First","start_time":0,"end_time":1},{"title":"Second","start_time":1,"end_time":3}]
    request={"video_url":"/api/video/"+source.name,"video_id":name,"clips":clips,
             "settings":{"caption_style":"none","title_position":"none","enable_face_tracking":False,"hardware_accel":"cpu"}}
    state={"batch_id":batch_id,"total_clips":2,"current_clip_index":0,"overall_status":"running","clips":[
        {"clip_index":i,"title":c["title"],"status":"pending","progress_percent":0} for i,c in enumerate(clips)]}
    job_store.enqueue(state,request)
    worker, stop, credentials=start_worker()
    restarted=None
    try:
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            saved=job_store.get_job(batch_id)["state"]
            if saved["clips"][0]["status"]=="completed":break
            time.sleep(.05)
        else:pytest.fail("First clip did not complete")
        first=Path(saved["clips"][0]["output_path"])
        original_mtime=first.stat().st_mtime_ns
        worker.terminate();worker.join(5);credentials.close()
        # Force the restart path even if a fast machine completed both clips.
        saved["overall_status"]="running";saved["clips"][1].update(status="rendering",progress_percent=70)
        job_store.save_state(saved)
        restarted, stop2, credentials2=start_worker()
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            recovered=job_store.get_job(batch_id)["state"]
            if recovered["overall_status"] in {"completed","error"}:break
            time.sleep(.1)
        assert recovered["overall_status"]=="completed",recovered
        assert all(c["status"]=="completed" for c in recovered["clips"])
        assert first.stat().st_mtime_ns==original_mtime
        assert all(Path(c["output_path"]).exists() for c in recovered["clips"])
        stop2.set();restarted.join(5);credentials2.close()
    finally:
        stop.set()
        for process in [worker,restarted]:
            if process and process.is_alive():process.terminate();process.join(5)
        source.unlink(missing_ok=True)
        for root in (EXPORTS_DIR,TEMP_DIR):
            for path in root.glob("*"+batch_id+"*"):
                if path.is_file():
                    try:path.unlink()
                    except PermissionError:pass

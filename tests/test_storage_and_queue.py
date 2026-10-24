import concurrent.futures
import os
import time

import pytest

from backend.services import job_store


@pytest.fixture
def media(tmp_path, monkeypatch):
    import backend.config as config
    from backend.services import system_service
    monkeypatch.setenv("JOB_DATABASE_PATH", str(tmp_path / "jobs.sqlite3"))
    base = tmp_path / "backend"
    temp = base / "temp_clips"
    uploads, exports = temp / "uploads", base / "exports"
    uploads.mkdir(parents=True)
    exports.mkdir()
    for module in (config, system_service):
        monkeypatch.setattr(module, "TEMP_DIR", temp)
        monkeypatch.setattr(module, "UPLOADS_DIR", uploads)
        monkeypatch.setattr(module, "_base_dir", str(base))
    monkeypatch.setattr(config, "EXPORTS_DIR", exports)
    return temp, uploads, exports, system_service


def write(path, size=100, age=0):
    path.write_bytes(b"x"*size)
    os.utime(path, (time.time()-age, time.time()-age))
    return path


def test_upload_counted_once_and_not_evicted_under_quota(media):
    _, uploads, _, cleanup = media
    path = write(uploads / "source.mp4", 3*1024*1024, 100)
    result = cleanup.auto_cleanup_expired_files(max_storage_bytes=5*1024*1024)
    assert path.exists()
    assert result["remaining_storage_bytes"] == 3*1024*1024
    assert result["total_cleaned_files"] == 0


def test_distinct_retention_and_no_deletion_of_leased_file(media):
    from backend.media_lifecycle import media_lease
    temp, uploads, exports, cleanup = media
    scratch = write(temp / "old.ass", age=7200)
    source = write(uploads / "source.mp4", age=7200)
    output = write(exports / "finished.mp4", age=7200)
    leased = write(temp / "working.mp4", age=7200)
    with media_lease(leased):
        cleanup.auto_cleanup_expired_files()
        assert leased.exists()
    assert not scratch.exists()
    assert source.exists() and output.exists()
    cleanup.auto_cleanup_expired_files()
    assert not leased.exists()


def test_queued_job_protects_sources_assets_and_intermediates(media):
    temp, uploads, _, cleanup = media
    source = write(uploads / "source.mp4", age=90000)
    bgm = write(uploads / "music.mp3", age=90000)
    working = write(temp / "batch_123_clip_0_raw.mp4", age=90000)
    job_store.enqueue({"batch_id":"batch_123", "clips":[], "overall_status":"running"},
                      {"video_url":"/api/video/source.mp4", "settings":{"bgm_file_path":str(bgm)}})
    result=cleanup.auto_cleanup_expired_files(max_storage_bytes=1)
    assert source.exists() and bgm.exists() and working.exists()
    assert result["quota_exceeded"]
    cleanup.clear_temp_files()
    assert working.exists()


def test_quota_recounts_after_removal(media):
    _, uploads, _, cleanup = media
    write(uploads / "old.mp4", 3*1024*1024, 100)
    result=cleanup.auto_cleanup_expired_files(max_storage_bytes=1024*1024)
    assert result["quota_deleted_files"] == 1
    assert result["remaining_storage_bytes"] == 0


def test_queue_claim_is_atomic_and_credentials_not_persisted(tmp_path,monkeypatch):
    monkeypatch.setenv("JOB_DATABASE_PATH",str(tmp_path/"queue.sqlite3"))
    state={"batch_id":"job", "overall_status":"running", "clips":[{"status":"pending"}]}
    job_store.enqueue(state,{"cookies":"VERY_SECRET_COOKIE","settings":{}})
    assert job_store.get_job("job")["request"]["cookies"] is None
    assert b"VERY_SECRET_COOKIE" not in job_store.database_path().read_bytes()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        claimed=list(pool.map(lambda _:job_store.claim_next(),range(4)))
    assert sum(item is not None for item in claimed)==1
    with pytest.raises(ValueError):job_store.enqueue(state,{},retry=True)


def test_resume_preserves_completed_clips_and_requeues_only_interrupted(tmp_path,monkeypatch):
    monkeypatch.setenv("JOB_DATABASE_PATH",str(tmp_path/"queue.sqlite3"))
    state={"batch_id":"job", "overall_status":"running", "clips":[{"status":"completed","download_url":"/done"},{"status":"rendering"},{"status":"error"}]}
    job_store.enqueue(state,{})
    job_store.claim_next()
    job_store.save_state(state)
    job_store.interrupt("job")
    _, _, recovered=job_store.claim_next()
    assert [c["status"] for c in recovered["clips"]]==["completed","pending","error"]
    assert recovered["clips"][0]["download_url"]=="/done"

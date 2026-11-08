from backend.services.prepared_sources import prepared_source,acquire_render_source


def setup_source(tmp_path,monkeypatch):
    import backend.config as config
    for key in ('TEMP_DIR','EXPORTS_DIR','UPLOADS_DIR'):monkeypatch.setattr(config,key,tmp_path)
    monkeypatch.setattr(config,'is_valid_mp4',lambda path:True)
    monkeypatch.setattr(config,'get_video_file_metadata',lambda path:{'duration':60})
    source=tmp_path/'manual.mp4';source.write_bytes(b'prepared source bytes')
    return {'start_time':120,'end_time':180,'source_clip_start_time':120,'source_clip_end_time':180,'source_clip_url':'/api/video/manual.mp4'}


def test_exact_prepared_clip_is_copied_without_reencoding_or_downloading(tmp_path,monkeypatch):
    clip=setup_source(tmp_path,monkeypatch)
    import backend.config as config
    monkeypatch.setattr(config,'download_clip_segment',lambda *args:(_ for _ in ()).throw(AssertionError('Unexpected download')))
    result=acquire_render_source(clip,'https://youtube.com/watch?v=abcdefghijk','render-source.mp4')
    assert result==str(tmp_path/'render-source.mp4')
    assert (tmp_path/'render-source.mp4').read_bytes()==b'prepared source bytes'


def test_later_trim_uses_correct_relative_offset_and_extension_uses_original(tmp_path,monkeypatch):
    clip=setup_source(tmp_path,monkeypatch);calls=[]
    import backend.config as config
    monkeypatch.setattr(config,'download_clip_segment',lambda *args:calls.append(args) or 'source')
    acquire_render_source({**clip,'start_time':130,'end_time':170},'original','trimmed.mp4')
    assert calls[-1][:3]==('/api/video/manual.mp4',10,50)
    acquire_render_source({**clip,'start_time':110},'original','extended.mp4')
    assert calls[-1][:3]==('original',110,180)


def test_missing_corrupt_outside_or_short_prepared_source_falls_back(tmp_path,monkeypatch):
    clip=setup_source(tmp_path,monkeypatch)
    assert prepared_source({**clip,'source_clip_url':'/api/video/../outside.mp4'}) is None
    assert prepared_source({**clip,'source_clip_end_time':float('nan')}) is None
    import backend.config as config
    monkeypatch.setattr(config,'get_video_file_metadata',lambda path:{'duration':10})
    assert prepared_source(clip) is None
    (tmp_path/'manual.mp4').unlink()
    assert prepared_source(clip) is None


def test_queued_prepared_sources_are_protected_from_cleanup(tmp_path,monkeypatch):
    clip=setup_source(tmp_path,monkeypatch)
    from backend.services import job_store
    from backend.media_lifecycle import protected_media
    monkeypatch.setattr(job_store,'protected_requests',lambda:[('batch_waiting',{'clips':[clip]})])
    protected,prefixes=protected_media()
    assert (tmp_path/'manual.mp4').resolve() in protected
    assert 'batch_waiting' in prefixes

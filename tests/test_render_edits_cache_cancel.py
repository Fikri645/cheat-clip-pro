import pytest
from backend.services.render_cache import cached, source_identity, word_cache
from backend.services import job_store
from backend.schemas.render import RenderBatchRequest
from backend.routers.client_render import ClientPlanRequest, prepare_plan


def test_word_cache_ignores_style_but_tracks_media_transcript_interval_and_model(tmp_path, monkeypatch):
    monkeypatch.setenv('RENDER_CACHE_DIR', str(tmp_path/'cache'))
    source=tmp_path/'source.wav'; source.write_bytes(b'first')
    calls=[]
    def load():
        calls.append(1); return [{'word':'Hello','start':0,'end':1}]
    identity=source_identity(source)
    word_cache(identity,0,2,[],None,load)
    word_cache(identity,0,2,[],None,load)
    assert len(calls)==1
    word_cache(identity,0,3,[],None,load)
    word_cache(identity,0,2,[{'text':'Changed'}],None,load)
    monkeypatch.setenv('WHISPER_MODEL','different')
    word_cache(identity,0,2,[],None,load)
    source.write_bytes(b'second');assert source_identity(source)!=identity
    assert len(calls)==4


def test_edited_captions_bypass_transcription_and_style_remains_independent(monkeypatch):
    import backend.video_engine as engine
    monkeypatch.setattr(engine,'transcribe_clip_words',lambda *args:pytest.fail('Edited words must bypass Whisper'))
    request=ClientPlanRequest(start_time=20,end_time=22,caption_words=[{'word':'Corrected','start':.1,'end':1}])
    first=prepare_plan(request)
    second=prepare_plan(request.model_copy(update={'text_case':'lowercase','caption_style':'clean_minimal'}))
    assert first['words']==second['words']==[{'word':'Corrected','start':.1,'end':1.0}]
    assert first['caption_events'][0]['words'][0]['word_text']=='CORRECTED'
    assert second['caption_events'][0]['words'][0]['word_text']=='corrected'


def test_invalid_caption_timing_is_rejected_for_server_render():
    for words in [[{'word':'Bad','start':0,'end':4}],[{'word':'A','start':0,'end':1},{'word':'B','start':.5,'end':2}]]:
        with pytest.raises(ValueError):RenderBatchRequest(video_url='local',video_id='upload_test',clips=[{'start_time':0,'end_time':2,'caption_words':words}],settings={})


def test_presentation_changes_reuse_prepared_words_and_tracking(tmp_path,monkeypatch):
    monkeypatch.setenv('RENDER_CACHE_DIR',str(tmp_path/'cache'))
    import backend.video_engine as engine
    import backend.services.face_tracking as tracking
    calls=[]
    monkeypatch.setattr(engine,'transcribe_clip_words',lambda *args:(calls.append('words') or [{'word':'Hello','start':0,'end':1}]))
    request=ClientPlanRequest(start_time=0,end_time=2,transcript=[{'start':0,'end':2,'text':'Hello'}])
    prepare_plan(request)
    prepare_plan(request.model_copy(update={'text_case':'lowercase','caption_style':'clean_minimal'}))
    assert calls==['words']
    source=tmp_path/'source.mp4';source.write_bytes(b'video')
    monkeypatch.setattr(tracking,'_detect_crop_trajectory_uncached',lambda *args:(calls.append('tracking') or []))
    tracking.detect_crop_trajectory(source)
    tracking.detect_crop_trajectory(source)
    assert calls==['words','tracking']


def test_cancel_queued_and_running_jobs_preserves_completed_clips(tmp_path,monkeypatch):
    monkeypatch.setenv('JOB_DATABASE_PATH',str(tmp_path/'jobs.sqlite3'))
    def state(id):return {'batch_id':id,'overall_status':'running','clips':[{'status':'completed','download_url':'done.mp4'},{'status':'pending'}]}
    job_store.enqueue(state('queued'),{})
    assert job_store.request_cancel('queued')['overall_status']=='cancelled'
    assert job_store.claim_next() is None
    job_store.enqueue(state('active'),{})
    job_store.claim_next()
    assert job_store.request_cancel('active')['overall_status']=='cancelling'
    job_store.save_state(state('active'))
    assert job_store.get_job('active')['status']=='cancelling'
    final=job_store.finish_cancel('active')
    assert final['clips'][0]['status']=='completed'
    assert final['clips'][1]['status']=='cancelled'

"""Cancel a real encoder process; finished clips and their bytes must survive."""
import shutil
import subprocess
import time
import uuid
from pathlib import Path
import psutil
import pytest
from backend.services import job_store
from backend.render_worker import start_worker


@pytest.mark.skipif(not shutil.which('ffmpeg'),reason='Requires FFmpeg')
def test_cancel_stops_job_tree_and_keeps_completed_clip(tmp_path,monkeypatch):
    monkeypatch.setenv('JOB_DATABASE_PATH',str(tmp_path/'jobs.sqlite3'))
    from backend.config import UPLOADS_DIR,EXPORTS_DIR,TEMP_DIR
    name='upload_cancel_'+uuid.uuid4().hex
    source=UPLOADS_DIR/(name+'.mp4');batch_id='cancel_'+uuid.uuid4().hex
    subprocess.run(['ffmpeg','-y','-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30:duration=25',
        '-c:v','libx264','-preset','ultrafast',str(source)],check=True)
    clips=[{'title':'Finished','start_time':0,'end_time':.4},{'title':'Cancel this','start_time':1,'end_time':25}]
    request={'video_url':'/api/video/'+source.name,'video_id':name,'clips':clips,
        'settings':{'caption_style':'none','title_position':'none','enable_face_tracking':False,'hardware_accel':'cpu'}}
    state={'batch_id':batch_id,'overall_status':'running','total_clips':2,'current_clip_index':0,'clips':[
        {'clip_index':i,'title':clip['title'],'status':'pending','progress_percent':0} for i,clip in enumerate(clips)]}
    job_store.enqueue(state,request);worker,stop,credentials=start_worker()
    try:
        deadline=time.monotonic()+60
        while time.monotonic()<deadline:
            saved=job_store.get_job(batch_id)['state']
            if saved['clips'][0]['status']=='completed':break
            time.sleep(.02)
        else:pytest.fail('First clip did not finish')
        first=Path(saved['clips'][0]['output_path']);before=first.read_bytes()
        children=psutil.Process(worker.pid).children(recursive=True)
        job_store.request_cancel(batch_id)
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            saved=job_store.get_job(batch_id)['state']
            if saved['overall_status']=='cancelled':break
            time.sleep(.05)
        assert saved['overall_status']=='cancelled',saved
        assert saved['clips'][0]['status']=='completed'
        assert saved['clips'][1]['status']=='cancelled'
        assert first.read_bytes()==before
        assert not any(child.is_running() and child.status()!=psutil.STATUS_ZOMBIE for child in children)
        assert list(EXPORTS_DIR.glob('*'+batch_id+'*.mp4'))==[first]
    finally:
        stop.set();worker.join(10);credentials.close()
        if worker.is_alive():worker.terminate();worker.join(5)
        source.unlink(missing_ok=True)
        for root in (EXPORTS_DIR,TEMP_DIR):
            for path in root.glob('*'+batch_id+'*'):
                if path.is_file():path.unlink(missing_ok=True)

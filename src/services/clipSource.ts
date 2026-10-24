import type { AnalyzeResponse,ViralClip } from '../types';
import { getStoredCookies } from '../utils/cookieUtils';

export async function acquireClipSource(result:AnalyzeResponse, clip:ViralClip, fileUrl?:string, signal?:AbortSignal) {
  signal?.throwIfAborted();
  const local=result.source_type==='upload' || result.source_type==='gdrive' || /^(upload_|gdrive_)/.test(result.video_id);
  if(local) return {url:fileUrl || result.video_url || `/api/video/${result.video_id}`,start:clip.start_time};
  // Do not abort the initial POST before receiving its job ID: cancellation must
  // also stop the corresponding server download, including a slow-starting one.
  const response=await fetch('/api/download-raw-clip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    video_url:`https://www.youtube.com/watch?v=${result.video_id}`, video_id:result.video_id,
    start_time:clip.start_time,end_time:clip.end_time,title:clip.title,cookies:getStoredCookies() || undefined,
  })});
  const job=await response.json();if(!response.ok)throw new Error(job.detail || 'Could not acquire source clip');
  const cancel=()=>{void fetch(`/api/download-raw-clip/${job.job_id}/cancel`,{method:'POST'});};
  signal?.addEventListener('abort',cancel,{once:true});
  try {
    if(signal?.aborted){cancel();signal.throwIfAborted();}
    const deadline=Date.now()+30*60*1000;
    while(true) {
      signal?.throwIfAborted();
      if(Date.now()>deadline){cancel();throw new Error('Source download timed out; retry this clip');}
      const status=await fetch(`/api/download-raw-clip-status/${job.job_id}`,{signal});
      const snapshot=await status.json();
      if(!status.ok || ['failed','cancelled'].includes(snapshot.status))throw new Error(snapshot.error || 'Could not download source');
      if(snapshot.status==='ready' && snapshot.download_url)return {url:snapshot.download_url as string,start:0};
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  } finally {signal?.removeEventListener('abort',cancel);}
}

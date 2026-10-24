import type { AnalyzeResponse, BatchRenderProgress, RenderSettings, ViralClip } from '../types';
import { getStoredCookies } from '../utils/cookieUtils';
import type { BrowserRenderOptions } from './browserCompositor';
import { triggerBrowserDownload } from './clientRenderer';

export async function renderClientBatch(settings: RenderSettings, result: AnalyzeResponse,
  uploadedFile: File | null, onProgress:(state:BatchRenderProgress)=>void, previous?:BatchRenderProgress, retryIndices?:number[]) {
  const batchId=`client_${Date.now()}`;
  const groups:ViralClip[][]=settings.renderMode==='merged' ? [settings.selectedClips] : settings.selectedClips.map(c=>[c]);
  let state:BatchRenderProgress={batch_id:batchId,total_clips:groups.length,current_clip_index:0,overall_status:'running',
    clips:groups.map((clips,i)=>({clip_index:i,title:settings.renderMode==='merged'?settings.compilationTitle || 'Highlight Compilation':clips[0].title_suggestion || clips[0].title,status:'pending',progress_percent:0}))};
  if(previous) state={...previous,overall_status:'running',warning_message:undefined,error_message:undefined,
    clips:previous.clips.map((clip,index)=>(retryIndices?retryIndices.includes(index):clip.status==='error')
      ? {...clip,status:'pending',progress_percent:0,error:undefined,error_message:undefined} : {...clip})};
  const publish=()=>onProgress({...state,clips:state.clips.map(c=>({...c}))});
  const fileUrl=uploadedFile ? URL.createObjectURL(uploadedFile) : undefined;
  const completed:{name:string;blob:Blob}[]=[];
  const downloadName=(title:string)=>`${settings.fileNamePrefix || ''}${title}${settings.fileNameSuffix || ''}`.replace(/[\\/*?:"<>|]/g,'').trim() || 'clip';
  try {
    for(let i=0;i<groups.length;i++) {
      if(state.clips[i].status==='completed' && state.clips[i].download_url) {
        completed.push({name:`${downloadName(state.clips[i].title)}.mp4`,blob:await (await fetch(state.clips[i].download_url!)).blob()});
        continue;
      }
      if(previous && state.clips[i].status==='error')continue;
      state.current_clip_index=i;state.clips[i].status='downloading';publish();
      try {
        const options:BrowserRenderOptions[]=[];
        for(const clip of groups[i]) {
          let source=fileUrl || result.video_url || `/api/video/${result.video_id}`;
          let local=true;
          if(result.source_type==='youtube' || (!result.source_type && !result.video_id.startsWith('upload_') && !result.video_id.startsWith('gdrive_'))) {
            const response=await fetch('/api/download-raw-clip',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
              video_url:`https://www.youtube.com/watch?v=${result.video_id}`,video_id:result.video_id,
              start_time:clip.start_time,end_time:clip.end_time,title:clip.title,cookies:getStoredCookies() || undefined,
            })});
            const job=await response.json();if(!response.ok)throw new Error(job.detail || 'Could not acquire source clip');
            const deadline=Date.now()+30*60*1000;
            while(true) {
              if(Date.now()>deadline)throw new Error('Source download timed out; retry this clip');
              const status=await fetch(`/api/download-raw-clip-status/${job.job_id}`);
              const snapshot=await status.json();if(!status.ok || snapshot.status==='failed')throw new Error(snapshot.error || 'Could not download source');
              if(snapshot.status==='ready' && snapshot.download_url){source=snapshot.download_url;break;}
              await new Promise(resolve=>setTimeout(resolve,700));
            }
            local=false;
          }
          options.push({videoSourceUrl:source,startTime:local?clip.start_time:0,endTime:local?clip.end_time:clip.end_time-clip.start_time,
            aspectRatio:settings.aspectRatio,backgroundStyle:settings.backgroundStyle,settings,
            clip:settings.renderMode==='merged'?{...clip,title:state.clips[i].title,title_suggestion:state.clips[i].title}:clip,
            transcript:result.transcript,audioSource:!local?source:(result.video_url?.startsWith('blob:')?`/api/video/${result.video_id}`:result.video_url),
            audioSourceStart:local?clip.start_time:0, timelineStart:clip.start_time});
        }
        const {encodeBrowser}=await import('./browserEncoder');
        const batch={...options[0],segments:options,onProgress:(percent:number,stage:string)=>{
          state.clips[i].status='rendering';state.clips[i].progress_percent=percent;state.clips[i].error_message=stage;publish();
        }};
        let blob:Blob;
        if(settings.hardwareAccel==='client_gpu') {
          try {blob=await encodeBrowser(batch,'gpu');}
          catch(error){console.warn('GPU encoder failed; retrying the same composition with WASM',error);blob=await encodeBrowser(batch,'wasm');}
        } else blob=await encodeBrowser(batch,'wasm');
        const name=downloadName(state.clips[i].title);
        triggerBrowserDownload(blob,`${name}.mp4`);
        completed.push({name:`${name}.mp4`,blob});
        state.clips[i]={...state.clips[i],status:'completed',progress_percent:100,download_url:URL.createObjectURL(blob),error_message:undefined};
      } catch(error){state.clips[i]={...state.clips[i],status:'error',error_message:error instanceof Error?error.message:String(error)};}
      publish();
    }
    if(completed.length) {
      try {
        const {browserZip}=await import('./browserZip');
        state.zip_url=URL.createObjectURL(await browserZip(completed));
      } catch {state.warning_message='MP4 files are ready; ZIP packaging failed.';}
    }
    state.overall_status=state.clips.every(c=>c.status==='error')?'error':'completed';
    if(state.clips.some(c=>c.status==='error'))state.warning_message='Some clips failed. Completed clips remain available.';
    publish();
  } finally {if(fileUrl)URL.revokeObjectURL(fileUrl);}
}

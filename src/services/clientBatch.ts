import {browserZip} from './browserZip';
import type { AnalyzeResponse,BatchRenderProgress,RenderSettings,ViralClip } from '../types';
import type { BrowserRenderOptions } from './browserCompositor';
import { triggerBrowserDownload } from './clientRenderer';
import { acquireClipSource } from './clipSource';
import { saveRender,type SavedRender } from './workspaceStore';

export async function renderClientBatch(settings: RenderSettings, result: AnalyzeResponse,
  uploadedFile: File | null, onProgress:(state:BatchRenderProgress)=>void, previous?:BatchRenderProgress, retryIndices?:number[], signal?:AbortSignal) {
  const batchId=`client_${Date.now()}`;
  const groups:ViralClip[][]=settings.renderMode==='merged' ? [settings.selectedClips] : settings.selectedClips.map(c=>[c]);
  let state:BatchRenderProgress={video_id:result.video_id,batch_id:batchId,total_clips:groups.length,current_clip_index:0,overall_status:'running',
    clips:groups.map((clips,i)=>({clip_index:i,title:settings.renderMode==='merged'?settings.compilationTitle || 'Highlight Compilation':clips[0].title_suggestion || clips[0].title,status:'pending',progress_percent:0}))};
  if(previous) state={...previous,overall_status:'running',warning_message:undefined,error_message:undefined,
    clips:previous.clips.map((clip,index)=>(retryIndices?retryIndices.includes(index):['error','cancelled'].includes(clip.status))
      ? {...clip,status:'pending',progress_percent:0,error:undefined,error_message:undefined} : {...clip})};
  const saved:SavedRender={id:state.batch_id,state,files:{},context:{settings,result}};
  let persistence=Promise.resolve();
  const publish=()=>{
    const snapshot={...state,clips:state.clips.map(c=>({...c}))};onProgress(snapshot);
    persistence=persistence.catch(()=>{}).then(()=>saveRender({...saved,state:snapshot,files:{...saved.files}})).then(()=>{});
  };
  const fileUrl=uploadedFile ? URL.createObjectURL(uploadedFile) : undefined;
  const completed:{name:string;blob:Blob}[]=[];
  const downloadName=(title:string)=>`${settings.fileNamePrefix || ''}${title}${settings.fileNameSuffix || ''}`.replace(/[\\/*?:"<>|]/g,'').trim() || 'clip';
  try {
    for(let i=0;i<groups.length;i++) {
      signal?.throwIfAborted();
      if(state.clips[i].status==='completed' && state.clips[i].download_url) {
        const blob=await (await fetch(state.clips[i].download_url!,{signal})).blob();saved.files[String(i)]=blob;
        completed.push({name:`${downloadName(state.clips[i].title)}.mp4`,blob});
        continue;
      }
      if(previous && state.clips[i].status==='error')continue;
      state.current_clip_index=i;state.clips[i].status='downloading';publish();
      try {
        const options:BrowserRenderOptions[]=[];
        for(const clip of groups[i]) {
          const acquired=await acquireClipSource(result,clip,fileUrl,signal);
          const source=acquired.url,local=acquired.start!==0 || result.source_type==='upload' || result.source_type==='gdrive' || /^(upload_|gdrive_)/.test(result.video_id);
          options.push({videoSourceUrl:source,startTime:local?clip.start_time:0,endTime:local?clip.end_time:clip.end_time-clip.start_time,
            aspectRatio:settings.aspectRatio,backgroundStyle:settings.backgroundStyle,settings,
            clip:settings.renderMode==='merged'?{...clip,title:state.clips[i].title,title_suggestion:state.clips[i].title}:clip,
            transcript:result.transcript,audioSource:!local?source:(result.video_url?.startsWith('blob:')?`/api/video/${result.video_id}`:result.video_url),
            audioSourceStart:local?clip.start_time:0, timelineStart:clip.start_time});
        }
        const {encodeBrowser}=await import('./browserEncoder');
        const batch={...options[0],segments:options,signal,onProgress:(percent:number,stage:string)=>{
          state.clips[i].status='rendering';state.clips[i].progress_percent=percent;state.clips[i].error_message=stage;publish();
        }};
        let blob:Blob;
        if(settings.hardwareAccel==='client_gpu') {
          try {blob=await encodeBrowser(batch,'gpu');}
          catch(error){signal?.throwIfAborted();console.warn('GPU encoder failed; retrying the same composition with WASM',error);blob=await encodeBrowser(batch,'wasm');}
        } else blob=await encodeBrowser(batch,'wasm');
        signal?.throwIfAborted();saved.files[String(i)]=blob;
        const name=downloadName(state.clips[i].title);
        triggerBrowserDownload(blob,`${name}.mp4`);
        completed.push({name:`${name}.mp4`,blob});
        state.clips[i]={...state.clips[i],status:'completed',progress_percent:100,download_url:URL.createObjectURL(blob),error_message:undefined};
      } catch(error){signal?.throwIfAborted();state.clips[i]={...state.clips[i],status:'error',error_message:error instanceof Error?error.message:String(error)};}
      publish();
    }
    if(completed.length) {
      try {

        const zip=await browserZip(completed);saved.files.zip=zip;state.zip_url=URL.createObjectURL(zip);
      } catch {state.warning_message='MP4 files are ready; ZIP packaging failed.';}
    }
    state.overall_status=state.clips.every(c=>c.status==='error')?'error':'completed';
    if(state.clips.some(c=>c.status==='error'))state.warning_message='Some clips failed. Completed clips remain available.';
    publish();
  } catch(error) {
    if(!signal?.aborted)throw error;
    state.overall_status='cancelled';
    for(const clip of state.clips)if(clip.status!=='completed')clip.status='cancelled';
    if(completed.length){saved.files.zip=await browserZip(completed);state.zip_url=URL.createObjectURL(saved.files.zip);}
    publish();
  } finally {
    try {await persistence;}catch {state.warning_message='Export is ready, but could not be saved on this device. Download it before closing.';onProgress({...state});}
    if(fileUrl)URL.revokeObjectURL(fileUrl);}
}

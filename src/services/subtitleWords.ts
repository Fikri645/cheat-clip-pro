import type {AnalyzeResponse,CaptionWord,ViralClip} from '../types';
import {getCookiesForRequest} from '../utils/cookieUtils';

export async function loadSubtitleWords(result:AnalyzeResponse, clip:ViralClip, signal:AbortSignal):Promise<CaptionWord[]> {
  const local=result.source_type==='upload' || result.source_type==='gdrive' || /^(upload_|gdrive_)/.test(result.video_id);
  const response=await fetch('/api/subtitle-words',{method:'POST',headers:{'Content-Type':'application/json'},signal,
    body:JSON.stringify({video_id:result.video_id,audio_source:result.video_url || '',start_time:clip.start_time,end_time:clip.end_time,
      transcript:result.transcript || [],cookies:local?undefined:(await getCookiesForRequest(signal)) || undefined})});
  const data=await response.json();
  if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Could not load subtitles');
  return data.words;
}

import type {AnalyzeResponse,NewRecommendations} from '../types';
import {excludedRanges} from '../utils/recommendations';

export interface RecommendationSettings {
  api_provider:'gemini'|'openrouter';api_key?:string;openrouter_key?:string;model:string;
  duration:string;target_clip_count:number;custom_prompt:string;
}
interface Progress {current?:number;total?:number;message?:string}

export async function readRecommendations(response:Response,signal:AbortSignal,onProgress:(event:Progress)=>void):Promise<Omit<NewRecommendations,'video_id'>> {
  if(!response.ok) {
    const data=await response.json().catch(()=>({}));
    throw new Error(typeof data.detail==='string'?data.detail:'Could not request new recommendations');
  }
  if(!response.body)throw new Error('No recommendation stream received');
  const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
  const parse=(line:string)=>{
    if(!line.startsWith('data:'))return;
    const event=JSON.parse(line.slice(5).trim());
    if(event.error)throw new Error(event.error);
    if(event.done)return event as Omit<NewRecommendations,'video_id'>;
    onProgress(event);
  };
  try {
    while(true) {
      signal.throwIfAborted();const {value,done}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
      const lines=buffer.split(/\r?\n/);buffer=lines.pop() || '';
      for(const line of lines){const result=parse(line);if(result)return result;}
      if(done){const result=parse(buffer);if(result)return result;throw new Error('Connection closed before recommendation analysis finished');}
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export async function findNewRecommendations(result:AnalyzeResponse,settings:RecommendationSettings,signal:AbortSignal,onProgress:(event:Progress)=>void):Promise<NewRecommendations> {
  // Explicitly fresh: reuse the transcript, never the old recommendation cache.
  const response=await fetch('/api/reanalyze',{method:'POST',headers:{'Content-Type':'application/json'},signal,
    body:JSON.stringify({analysis:result,...settings,excluded_ranges:excludedRanges(result)})});
  return {...await readRecommendations(response,signal,onProgress),video_id:result.video_id};
}

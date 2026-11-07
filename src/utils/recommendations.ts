import type {AnalyzeResponse,ClipInterval,NewRecommendations} from '../types';

export const overlaps=(first:ClipInterval,second:ClipInterval)=>Math.min(first.end_time,second.end_time)>Math.max(first.start_time,second.start_time);
export function excludedRanges(result:AnalyzeResponse):ClipInterval[] {
  const all=[...(result.recommendation_excluded_ranges || []),...result.clips].filter(item=>Number.isFinite(item.start_time)&&Number.isFinite(item.end_time)&&item.start_time>=0&&item.end_time>item.start_time);
  const merged:ClipInterval[]=[];
  for(const item of [...all].sort((a,b)=>a.start_time-b.start_time)) {
    const last=merged.at(-1);
    if(last&&item.start_time<=last.end_time)last.end_time=Math.max(last.end_time,item.end_time);
    else merged.push({start_time:item.start_time,end_time:item.end_time});
  }
  return merged;
}

export function appendRecommendations(current:AnalyzeResponse,incoming:NewRecommendations):AnalyzeResponse {
  if(current.video_id!==incoming.video_id)return current;
  const excluded=excludedRanges(current);
  const timelineEnd=Math.max(current.duration,...(current.transcript || []).map(line=>Number.isFinite(line.end)?line.end:0));
  const additions=incoming.clips.filter(clip=>{
    if(!Number.isFinite(clip.start_time)||!Number.isFinite(clip.end_time)||clip.start_time<0||clip.end_time>timelineEnd||clip.end_time<=clip.start_time||excluded.some(old=>overlaps(clip,old)))return false;
    excluded.push({start_time:clip.start_time,end_time:clip.end_time});return true;
  });
  return {...current,clips:[...current.clips,...additions],recommendation_round:Math.max(current.recommendation_round || 0,incoming.recommendation_round),
    recommendation_excluded_ranges:excludedRanges({...current,clips:[...current.clips,...additions]})};
}

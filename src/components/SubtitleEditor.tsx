import { useEffect,useRef,useState } from 'react';
import { acquireClipSource } from '../services/clipSource';
import type { AnalyzeResponse,CaptionWord,ViralClip } from '../types';
import { captionValidation } from '../utils/captionWords';
import { getErrorMessage } from '../utils/errors';

export function SubtitleEditor({result,clip,onApply}:{result:AnalyzeResponse;clip:ViralClip;onApply:(words:CaptionWord[])=>void}) {
  const [words,setWords]=useState<CaptionWord[]>(()=>clip.caption_words || []);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const abort=useRef<AbortController|null>(null);
  useEffect(()=>()=>abort.current?.abort(),[]);
  const duration=clip.end_time-clip.start_time;
  const invalid=captionValidation(words,duration);
  const load=async()=>{
    const controller=new AbortController();abort.current=controller;setBusy(true);setMessage('');
    try {
      const source=await acquireClipSource(result,clip,undefined,controller.signal);
      const response=await fetch('/api/client-render-plan',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({audio_source:source.url,start_time:clip.start_time,audio_start_time:source.start,end_time:clip.end_time,
          transcript:result.transcript || [],caption_style:'clean_minimal',frames:[]})});
      const data=await response.json();if(!response.ok)throw new Error(data.detail || 'Could not load subtitles');
      // Clamp ASR output to the actual clip and remove overlaps before editing.
      let end=0;
      const loaded:CaptionWord[]=[];
      for(const item of data.words as CaptionWord[]) {
        const start=Math.max(end,item.start,0),finish=Math.min(duration,item.end);
        if(finish>start){loaded.push({word:item.word,start,end:finish});end=finish;}
      }
      setWords(loaded);setMessage(loaded.length?'Words loaded. Edit, then apply.':'No speech found. You can add words manually.');
    } catch(error){if(!controller.signal.aborted)setMessage(getErrorMessage(error));}
    finally {if(abort.current===controller){abort.current=null;setBusy(false);}}
  };
  return <section className="project-panel" aria-label="Subtitle editor">
    <h3>Subtitle editor / Editor subtitle</h3>
    <p><strong>{clip.title}</strong> · {clip.start_time.toFixed(2)}–{clip.end_time.toFixed(2)}s</p>
    <p>Correct words and timing without repeating AI analysis. Times are seconds from the start of this clip.</p>
    <div className="project-actions">
      <button type="button" disabled={busy} onClick={()=>void load()}>Load original words</button>
      {busy && <button type="button" onClick={()=>abort.current?.abort()}>Cancel loading</button>}
      <button type="button" disabled={busy || (words.at(-1)?.end || 0)>=duration} onClick={()=>{
        const start=words.at(-1)?.end || 0;setWords([...words,{word:'New word',start,end:Math.min(duration,start+.3)}]);
      }}>Add word</button>
    </div>
    <div className="caption-word-row caption-word-head" aria-hidden="true"><span>Word / Kata</span><span>Start (s)</span><span>End (s)</span><span/></div>
    <div className="caption-word-list">
      {words.map((word,index)=><div className="caption-word-row" key={index}>
        <input aria-label={`Word ${index+1}`} value={word.word} maxLength={300} onChange={e=>setWords(words.map((w,i)=>i===index?{...w,word:e.target.value}:w))}/>
        <input aria-label={`Start ${index+1}`} type="number" min={0} max={duration} step="0.01" value={word.start} onChange={e=>setWords(words.map((w,i)=>i===index?{...w,start:e.target.valueAsNumber}:w))}/>
        <input aria-label={`End ${index+1}`} type="number" min={0} max={duration} step="0.01" value={word.end} onChange={e=>setWords(words.map((w,i)=>i===index?{...w,end:e.target.valueAsNumber}:w))}/>
        <button type="button" aria-label={`Delete word ${index+1}`} onClick={()=>setWords(words.filter((_,i)=>i!==index))}>×</button>
      </div>)}
    </div>
    {invalid && <p role="alert">{invalid}</p>}
    <p role="status">{message}</p>
    <button type="button" disabled={busy || !!invalid} onClick={()=>{onApply(words.map(w=>({...w,word:w.word.trim()})));setMessage('Subtitles applied and included in the next export.');}}>Apply subtitles</button>
  </section>;
}

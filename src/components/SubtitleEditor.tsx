import {useEffect,useRef,useState} from 'react';
import {loadSubtitleWords} from '../services/subtitleWords';
import type {AnalyzeResponse,CaptionWord,ViralClip} from '../types';
import {captionValidation} from '../utils/captionWords';
import {getErrorMessage} from '../utils/errors';

const clipKey=(clip:ViralClip)=>clip.start_time+':'+clip.end_time;

interface SubtitleEditorProps {
  result:AnalyzeResponse;
  clip:ViralClip;
  selectedClips:ViralClip[];
  onSelectClip:(clip:ViralClip)=>void;
  onApply:(clip:ViralClip,words:CaptionWord[])=>void;
}

export function SubtitleEditor({result,clip,selectedClips,onSelectClip,onApply}:SubtitleEditorProps) {
  const [drafts,setDrafts]=useState<Record<string,CaptionWord[]>>({});
  const currentClip=selectedClips.find(item=>clipKey(item)===clipKey(clip)) || selectedClips[0] || clip;
  const wordsFor=(item:ViralClip)=>drafts[clipKey(item)] ?? item.caption_words;
  const words=wordsFor(currentClip) ?? [];
  const setWords=(updated:CaptionWord[])=>setDrafts(previous=>({...previous,[clipKey(currentClip)]:updated}));
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const abort=useRef<AbortController|null>(null);
  useEffect(()=>()=>abort.current?.abort(),[]);
  const duration=currentClip.end_time-currentClip.start_time;
  const invalid=captionValidation(words,duration);
  const missing=selectedClips.filter(item=>wordsFor(item)===undefined).length;
  const invalidClip=selectedClips.find(item=>captionValidation(wordsFor(item) ?? [],item.end_time-item.start_time));

  const load=async(targets:ViralClip[])=>{
    if(abort.current)return;
    const controller=new AbortController();abort.current=controller;setBusy(true);setMessage('');
    let completed=0;
    const failures:string[]=[];
    try {
      for(const [index,target] of targets.entries()) {
        controller.signal.throwIfAborted();
        setMessage('Loading '+(index+1)+'/'+targets.length+': '+target.title);
        try {
          const original=await loadSubtitleWords(result,target,controller.signal);
          controller.signal.throwIfAborted();
          // Timings belong to this clip; keep them ordered and inside its duration.
          let end=0;
          const loaded:CaptionWord[]=[];
          for(const item of original) {
            const start=Math.max(end,item.start,0),finish=Math.min(target.end_time-target.start_time,item.end);
            if(finish>start){loaded.push({word:item.word,start,end:finish});end=finish;}
          }
          setDrafts(previous=>({...previous,[clipKey(target)]:loaded}));
          completed++;
        } catch(error) {
          if(controller.signal.aborted)throw error;
          failures.push(target.title+': '+getErrorMessage(error));
        }
      }
      setMessage('Words loaded for '+completed+'/'+targets.length+' clips. Edit, then apply.'+(failures.length?' Failed: '+failures.join('; '):''));
    } catch(error) {
      setMessage(controller.signal.aborted?'Loading cancelled. Words from '+completed+' completed clips were kept.':getErrorMessage(error));
    } finally {
      if(abort.current===controller){abort.current=null;setBusy(false);}
    }
  };

  const apply=(targets:ViralClip[])=>{
    for(const target of targets)onApply(target,(wordsFor(target) ?? []).map(word=>({...word,word:word.word.trim()})));
    setMessage('Subtitles applied to '+targets.length+' clip'+(targets.length===1?'':'s')+' and included in the next export.');
  };

  return <section className="project-panel" aria-label="Subtitle editor">
    <h3>Subtitle editor / Editor subtitle</h3>
    <p>{selectedClips.length} selected clips / klip terpilih</p>
    {selectedClips.length>0 && <label style={{display:'grid',gap:'.4rem'}}>
      Clip / Klip
      <select aria-label="Subtitle clip" value={clipKey(currentClip)} onChange={event=>{
        const target=selectedClips.find(item=>clipKey(item)===event.target.value);
        if(target)onSelectClip(target);
      }} style={{width:'100%',minWidth:0,padding:'.6rem',background:'var(--bg-surface)',color:'var(--text-primary)'}}>
        {selectedClips.map((item,index)=><option key={clipKey(item)} value={clipKey(item)}>{index+1}. {item.title}</option>)}
      </select>
    </label>}
    <div className="project-actions">
      <button type="button" disabled={busy || !selectedClips.length} onClick={()=>void load([...selectedClips])}>Load original words — all selected ({selectedClips.length})</button>
      <button type="button" disabled={busy || !selectedClips.length || missing>0 || !!invalidClip} onClick={()=>apply(selectedClips)}>Apply subtitles — all selected ({selectedClips.length})</button>
      {busy && <button type="button" onClick={()=>abort.current?.abort()}>Cancel loading</button>}
    </div>
    {missing>0 && <p>Load words for {missing} remaining selected clip{missing===1?'':'s'} before applying to all.</p>}
    {invalidClip && <p role="alert">Fix subtitle timings or words in “{invalidClip.title}” before applying to all.</p>}
    <p><strong>{currentClip.title}</strong> · {currentClip.start_time.toFixed(2)}–{currentClip.end_time.toFixed(2)}s</p>
    <p>Correct words and timing without repeating AI analysis. Times are seconds from the start of this clip.</p>
    <div className="project-actions">
      <button type="button" disabled={busy} onClick={()=>void load([currentClip])}>Load original words</button>
      <button type="button" disabled={busy || (words.at(-1)?.end || 0)>=duration} onClick={()=>{
        const start=words.at(-1)?.end || 0;setWords([...words,{word:'New word',start,end:Math.min(duration,start+.3)}]);
      }}>Add word</button>
    </div>
    <div className="caption-word-row caption-word-head" aria-hidden="true"><span>Word / Kata</span><span>Start (s)</span><span>End (s)</span><span/></div>
    <fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}} aria-label="Subtitle words">
      <div className="caption-word-list">
        {words.map((word,index)=><div className="caption-word-row" key={index}>
          <input aria-label={'Word '+(index+1)} value={word.word} maxLength={300} onChange={e=>setWords(words.map((w,i)=>i===index?{...w,word:e.target.value}:w))}/>
          <input aria-label={'Start '+(index+1)} type="number" min={0} max={duration} step="0.01" value={word.start} onChange={e=>setWords(words.map((w,i)=>i===index?{...w,start:e.target.valueAsNumber}:w))}/>
          <input aria-label={'End '+(index+1)} type="number" min={0} max={duration} step="0.01" value={word.end} onChange={e=>setWords(words.map((w,i)=>i===index?{...w,end:e.target.valueAsNumber}:w))}/>
          <button type="button" aria-label={'Delete word '+(index+1)} onClick={()=>setWords(words.filter((_,i)=>i!==index))}>×</button>
        </div>)}
      </div>
    </fieldset>
    {invalid && <p role="alert">{invalid}</p>}
    <p role="status">{message}</p>
    <button type="button" disabled={busy || !!invalid} onClick={()=>apply([currentClip])}>Apply subtitles</button>
  </section>;
}

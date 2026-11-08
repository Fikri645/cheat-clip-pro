import type {Translations} from '../../locales';
import type {useReanalysis} from '../../hooks/useReanalysis';

interface Props {t:Translations;job:ReturnType<typeof useReanalysis>;hasTranscript:boolean;hasKey:boolean;focus:string;onFocusChange:(value:string)=>void}
export function ReanalysisPanel({t,job,hasTranscript,hasKey,focus,onFocusChange}:Props) {
  const state=job.state;
  return <section className="project-panel" aria-label={t.results.reanalyzeTitle}>
    <h3>{t.results.reanalyzeTitle}</h3>
    <p>{t.results.reanalyzeHint}</p>
    <label style={{display:'grid',gap:'.4rem'}}>
      {t.results.reanalyzeFocusLabel}
      <textarea value={focus} onChange={event=>onFocusChange(event.target.value)} maxLength={4000} rows={3} disabled={!!state?.busy}
        placeholder={t.results.reanalyzeFocusPlaceholder} style={{width:'100%',minWidth:0,resize:'vertical',padding:'.7rem',background:'var(--bg-surface)',color:'var(--text-primary)',border:'1px solid var(--border-color)'}}/>
    </label>
    <div className="project-actions">
      <button type="button" disabled={!!state?.busy} onClick={()=>onFocusChange(t.results.reanalyzeFunnyPrompt)}>{t.results.reanalyzeFunny}</button>
      <button type="button" disabled={!!state?.busy} onClick={()=>onFocusChange(t.results.reanalyzeControversialPrompt)}>{t.results.reanalyzeControversial}</button>
    </div>
    <div className="project-actions">
      <button type="button" disabled={!!state?.busy||!hasTranscript||!hasKey} onClick={()=>void job.start()}>{state?.busy?t.results.reanalyzing:t.results.reanalyzeButton}</button>
      {state?.busy&&<button type="button" onClick={job.cancel}>{t.results.reanalyzeCancel}</button>}
    </div>
    {!hasTranscript&&<p>{t.results.reanalyzeNoTranscript}</p>}
    {!hasKey&&<p>{t.results.reanalyzeNoKey}</p>}
    <p role="status" aria-live="polite">
      {state?.busy?t.results.reanalyzeProgress(state.current,state.total):state?.cancelled?t.results.reanalyzeCancelled:state?.outcome
        ?state.outcome.clips.length?t.results.reanalyzeFound(state.outcome.clips.length):state.outcome.exhausted?t.results.reanalyzeExhausted:t.results.reanalyzeNone:''}
    </p>
    {state?.error&&<p role="alert">{state.error}</p>}
    {state?.outcome?.warning&&<p role="alert">{state.outcome.warning}</p>}
  </section>;
}

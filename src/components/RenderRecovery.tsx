import type { BatchRenderProgress } from '../types';

export function RenderRecovery({ batch, onRetry, onCancel }: { batch: BatchRenderProgress; onRetry:()=>void;onCancel:()=>void }) {
  return <section className="glass-panel" aria-label="Recovered render" style={{padding:'1rem',marginBottom:'1rem'}}>
    <h2 style={{fontSize:'1rem'}}>Render {batch.overall_status === 'running' ? 'in progress' : batch.overall_status}</h2>
    <p style={{fontSize:'.85rem'}}>Your saved render job is available after reopening the app.</p>
    <ul>{batch.clips.map(clip=><li key={clip.clip_index}>
      {clip.title}: {clip.status === 'completed' ? <a href={clip.download_url} download>Download MP4</a> : `${clip.status} ${clip.progress_percent}%`}
      {clip.status === 'error' && <p>{clip.error_message}</p>}
    </li>)}</ul>
    {batch.overall_status!=='running' && batch.clips.some(clip=>['error','cancelled'].includes(clip.status)) && <button type="button" onClick={onRetry}>Retry unfinished clips</button>}
    {['running','cancelling'].includes(batch.overall_status) && <button type="button" onClick={onCancel} disabled={batch.overall_status==='cancelling'}>Cancel render</button>}
    {batch.zip_url && <a href={batch.zip_url} download>Download all clips</a>}
  </section>;
}

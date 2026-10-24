import {
AlertTriangle,
RefreshCw,
X
} from 'lucide-react';
import type { Translations } from '../../locales';
import type {
BatchRenderProgress
} from '../../types';
import { ClipRenderErrorBox } from './ClipRenderErrorBox';
interface Props {batchProgress?:BatchRenderProgress|null;
t:Translations;
onRetryClip?:(clipIndex?: number) => void;
onDismissProgress?:() => void;
titlePrefix:string;
titleSuffix:string;
fileNamePrefix:string;
fileNameSuffix:string;}
export function RenderQueuePanel({batchProgress,t,onRetryClip,onDismissProgress,titlePrefix,titleSuffix,fileNamePrefix,fileNameSuffix}:Props){return <>
      {/* Batch Render Queue & Results Dashboard Card - Located below bottom action bar */}
      {batchProgress && (
        <div className={`bottom-batch-dashboard-card ${batchProgress.overall_status === 'running' ? 'is-processing' : ''}`}>
          <div className="batch-progress-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h4 className="batch-queue-title">{t.studio.batchQueueTitle}</h4>
                {batchProgress.overall_status === 'running' && (
                  <span className="queue-generating-pill">
                    <span className="queue-pulse-dot"></span> * GENERATING VIDEO...
                  </span>
                )}
              </div>
              <p className="batch-subtitle">
                {batchProgress.overall_status === 'cancelled' ? 'Render cancelled. Finished clips are preserved.' : batchProgress.overall_status === 'cancelling' ? 'Stopping render…' : batchProgress.overall_status === 'completed'
                  ? (batchProgress.clips.some(c => ['error','cancelled'].includes(c.status))
                      ? t.studio.someClipsFailed(batchProgress.clips.filter(c => ['error','cancelled'].includes(c.status)).length, batchProgress.total_clips)
                      : t.studio.allClipsRendered(batchProgress.total_clips))
                  : batchProgress.overall_status === 'error'
                  ? (batchProgress.error_message || t.studio.allClipsFailed)
                  : t.studio.processingClip((batchProgress.current_clip_index || 0) + 1, batchProgress.total_clips)}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              {batchProgress.clips.some(c => ['error','cancelled'].includes(c.status)) && !['running','cancelling'].includes(batchProgress.overall_status) && onRetryClip && (
                <button
                  type="button"
                  onClick={() => onRetryClip()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    border: '1px solid rgba(245, 158, 11, 0.7)',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    boxShadow: '0 0 10px rgba(245, 158, 11, 0.35)',
                    transition: 'all 0.2s ease',
                  }}
                  title="Retry all failed clips in this batch"
                >
                  {t.studio.retryAllFailedBtn
                    ? t.studio.retryAllFailedBtn(batchProgress.clips.filter(c => ['error','cancelled'].includes(c.status)).length)
                    : `[~] Retry Failed (${batchProgress.clips.filter(c => ['error','cancelled'].includes(c.status)).length})`}
                </button>
              )}

              {(batchProgress.overall_status === 'completed' || batchProgress.clips.some(c => c.status === 'completed')) && (
                <a
                  href={batchProgress.zip_url || `/api/download-batch-zip/${batchProgress.batch_id}`}
                  download={`cheat_clip_pro_${batchProgress.batch_id}.zip`}
                  className="glowing-btn batch-zip-download-btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    border: '1px solid rgba(16, 185, 129, 0.6)',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.72rem',
                    padding: '0.3rem 0.65rem',
                    borderRadius: '6px',
                    textDecoration: 'none',
                    boxShadow: '0 0 12px rgba(16, 185, 129, 0.35)',
                    cursor: 'pointer',
                  }}
                >
                  [PKG] ZIP
                </a>
              )}

              {(batchProgress.overall_status === 'completed' || ['error','cancelled'].includes(batchProgress.overall_status)) && onDismissProgress && (
                <button
                  type="button"
                  className="studio-close-btn"
                  onClick={onDismissProgress}
                  style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1rem', padding: '0.1rem 0.3rem' }}
                  title={t.studio.dismissQueue}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Overall Batch Error Notice if all clips failed */}
          {batchProgress.overall_status === 'error' && (
            <div style={{
              margin: '0.5rem 0 0.2rem',
              padding: '0.55rem 0.75rem',
              background: 'rgba(255, 30, 39, 0.12)',
              border: '1px solid #ff1e27',
              borderRadius: 0,
              color: '#fca5a5',
              fontSize: '0.74rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.45rem',
              fontWeight: 600,
              boxShadow: '0 0 10px rgba(255, 30, 39, 0.25)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <AlertTriangle size={15} color="#ff1e27" />
                <span style={{ color: '#fff', fontWeight: 700 }}>{batchProgress.error_message || t.studio.allClipsFailed}</span>
              </div>
              {onRetryClip && (
                <button
                  type="button"
                  onClick={() => onRetryClip()}
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                    border: '1px solid rgba(245, 158, 11, 0.6)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.7rem',
                    padding: '3px 9px',
                    borderRadius: 0,
                    cursor: 'pointer',
                    boxShadow: '0 0 8px rgba(245, 158, 11, 0.35)',
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem'
                  }}
                >
                  <RefreshCw size={11} />
                  {t.studio.retryClipBtn || 'Retry'}
                </button>
              )}
            </div>
          )}

          {/* Overall Progress Bar */}
          <div className="batch-overall-bar-wrap">
            <div className="batch-overall-bar" style={{ height: '5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
              <div
                className="batch-overall-fill"
                style={{
                  height: '100%',
                  background: batchProgress.overall_status === 'error'
                    ? '#ef4444'
                    : 'linear-gradient(90deg, #ff5e3a, #ff2a5f)',
                  width: `${Math.round((batchProgress.clips.filter(c => c.status === 'completed').length / (batchProgress.total_clips || 1)) * 100)}%`,
                  transition: 'width 0.3s ease'
                }}
              ></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              <span>{t.batchProgress.completedMeta(batchProgress.clips.filter(c => c.status === 'completed').length, batchProgress.total_clips)}</span>
              <span>{Math.round((batchProgress.clips.filter(c => c.status === 'completed').length / (batchProgress.total_clips || 1)) * 100)}%</span>
            </div>
          </div>

          {/* Render Items List */}
          <div className="batch-render-items-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginTop: '0.6rem' }}>
            {batchProgress.clips.map((clip, idx) => {
              let rawBaseTitle = (clip.base_title || '').trim();
              if (!rawBaseTitle) {
                let t = (clip.title || `clip_${idx + 1}`).trim();
                if (titlePrefix && t.startsWith(titlePrefix)) {
                  t = t.slice(titlePrefix.length);
                }
                if (titleSuffix && t.endsWith(titleSuffix)) {
                  t = t.slice(0, t.length - titleSuffix.length);
                }
                rawBaseTitle = t.trim() || `clip_${idx + 1}`;
              }
              rawBaseTitle = rawBaseTitle.replace(/[\\/*?:"<>|]/g, '').trim() || `clip_${idx + 1}`;
              const fnPfx = (fileNamePrefix || '').replace(/[\\/*?:"<>|]/g, '');
              const fnSfx = (fileNameSuffix || '').replace(/[\\/*?:"<>|]/g, '');
              const cleanTitle = `${fnPfx}${rawBaseTitle}${fnSfx}`.trim() || rawBaseTitle;
              let dupCount = 0;
              for (let i = 0; i < idx; i++) {
                let priorBase = (batchProgress.clips[i].base_title || '').trim();
                if (!priorBase) {
                  let pt = (batchProgress.clips[i].title || `clip_${i + 1}`).trim();
                  if (titlePrefix && pt.startsWith(titlePrefix)) {
                    pt = pt.slice(titlePrefix.length);
                  }
                  if (titleSuffix && pt.endsWith(titleSuffix)) {
                    pt = pt.slice(0, pt.length - titleSuffix.length);
                  }
                  priorBase = pt.trim() || `clip_${i + 1}`;
                }
                priorBase = priorBase.replace(/[\\/*?:"<>|]/g, '').trim() || `clip_${i + 1}`;
                const priorTitle = `${fnPfx}${priorBase}${fnSfx}`.trim() || priorBase;
                if (priorTitle.toLowerCase() === cleanTitle.toLowerCase()) {
                  dupCount++;
                }
              }
              const finalClipName = dupCount > 0 ? `${cleanTitle} (${dupCount})` : cleanTitle;
              const dlUrlWithTitle = clip.download_url
                ? clip.download_url.startsWith('blob:') ? clip.download_url : `${clip.download_url}${clip.download_url.includes('?') ? '&' : '?'}title=${encodeURIComponent(finalClipName)}`
                : '';

              const isError = clip.status === 'error';
              const rawError = clip.error_message || clip.error || '';

              return (
                <div
                  key={idx}
                  className={`batch-item-row status-${clip.status}`}
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    background: isError ? 'rgba(239, 68, 68, 0.05)' : 'rgba(255,255,255,0.03)',
                    border: isError ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', maxWidth: '65%' }}>
                      <span style={{ fontSize: '0.7rem', color: isError ? '#f87171' : 'var(--text-muted)', fontWeight: 600 }}>#{idx + 1}</span>
                      <span style={{ fontSize: '0.75rem', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clip.title}</span>
                    </div>
                    <div>
                      {clip.status === 'pending' && <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{t.studio.statusWaitingShort}</span>}
                      {clip.status === 'downloading' && <span style={{ fontSize: '0.68rem', color: '#f59e0b' }}>{t.studio.statusSlicingShort}</span>}
                      {clip.status === 'transcribing' && <span style={{ fontSize: '0.68rem', color: '#8b5cf6' }}>{t.studio.statusCaptionsShort}</span>}
                      {clip.status === 'rendering' && <span style={{ fontSize: '0.68rem', color: '#3b82f6' }}>{t.studio.statusRenderingShort}</span>}
                      {clip.status === 'completed' && (
                        clip.download_url ? (
                          <a
                            href={dlUrlWithTitle}
                            download={`${finalClipName}.mp4`}
                            className="quick-dl-btn"
                            title={`Download ${finalClipName}.mp4`}
                          >
                            ⬇️ MP4
                          </a>
                        ) : (
                          <span className="quick-dl-btn" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
                            ✓ Done
                          </span>
                        )
                      )}
                      {isError && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              color: '#ff1e27',
                              background: 'rgba(255, 30, 39, 0.15)',
                              padding: '2px 8px',
                              borderRadius: 0,
                              border: '1px solid #ff1e27',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.25rem'
                            }}
                          >
                            <X size={11} /> {t.studio.statusFailedShort}
                          </span>
                          {onRetryClip && !['running','cancelling'].includes(batchProgress.overall_status) && (
                            <button
                              type="button"
                              onClick={() => onRetryClip(idx)}
                              style={{
                                background: 'rgba(245, 158, 11, 0.18)',
                                border: '1px solid rgba(245, 158, 11, 0.5)',
                                borderRadius: 0,
                                color: '#fbbf24',
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                padding: '2px 8px',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.25rem'
                              }}
                              title="Retry rendering this clip"
                            >
                              <RefreshCw size={11} />
                              {t.studio.retryClipBtn || 'Retry'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Visible Error Box when clip fails */}
                  {isError && rawError && (
                    <ClipRenderErrorBox
                      errorMessage={rawError}
                      t={t}
                      onRetry={onRetryClip && !['running','cancelling'].includes(batchProgress.overall_status) ? () => onRetryClip(idx) : undefined}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}


</>;}

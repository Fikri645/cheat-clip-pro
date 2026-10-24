import {
Download,
RotateCw
} from 'lucide-react';
import type React from 'react';
import type { Translations } from '../../locales';
import type { AnalyzeResponse,ViralClip,TranscriptLine } from '../../types';
import { HeatmapTimeline } from '../HeatmapTimeline';
interface Props {leftPanelRef:React.RefObject<HTMLDivElement | null>;
result:AnalyzeResponse;
directVideoPlayerRef:React.RefObject<HTMLVideoElement | null>;
setCurrentTime:React.Dispatch<React.SetStateAction<number>>;
startTracking:() => void;
stopTracking:() => void;
subtitlesSource:"youtube" | "manual";
currentSubtitle:TranscriptLine|undefined;
handleRefreshPlayer:() => void;
t:Translations;
handleDownloadRawVideo:(forceProceed?: boolean | React.MouseEvent) => Promise<void>;
isDownloadingRaw:boolean;
rawDownloadProgress:{ jobId: string; status: string; percent: number; downloaded: string; total: string; speed: string; eta: string; downloadUrl?: string; filename?: string; error?: string; }|null;
currentTime:number;
handleSeek:(seconds: number) => void;
activeClip:ViralClip|null;
extractHashtagsAndText:(summary: string) => { text: string; hashtags: string[]; };
toggleTimestampMenu:(target: "toolbar" | "overview", e: React.MouseEvent) => void;
copyTimestampMenuTarget:"toolbar" | "overview" | null;
renderTimestampFormatMenu:(align?: "left" | "right") => React.JSX.Element;
markedClips:Record<string, boolean>;
setActiveClip:React.Dispatch<React.SetStateAction<ViralClip | null>>;
toggleMarkedClip:(clipId: string) => void;
handleCopyTimestamp:(clip: ViralClip, e?: React.MouseEvent) => void;
formatSeconds:(secs: number) => string;}
export function SourcePlayerPanel({leftPanelRef,result,directVideoPlayerRef,setCurrentTime,startTracking,stopTracking,subtitlesSource,currentSubtitle,handleRefreshPlayer,t,handleDownloadRawVideo,isDownloadingRaw,rawDownloadProgress,currentTime,handleSeek,activeClip,extractHashtagsAndText,toggleTimestampMenu,copyTimestampMenuTarget,renderTimestampFormatMenu,markedClips,setActiveClip,toggleMarkedClip,handleCopyTimestamp,formatSeconds}:Props){return <>
                  {/* Left panel: Player + Heatmap */}
                  <div className="sticky-player-panel" ref={leftPanelRef}>
                    <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      <h2 style={{ fontSize: '1.25rem', lineHeight: 1.3 }}>{result.title}</h2>

                      <div className="video-wrapper" style={{ position: 'relative' }}>
                        {(result.video_url || result.source_type === 'upload' || result.source_type === 'gdrive' || result.video_id?.startsWith('upload_') || result.video_id?.startsWith('gdrive_')) ? (
                          <video
                            key={`direct-player-${result.video_id}`}
                            ref={directVideoPlayerRef}
                            src={result.video_url ? encodeURI(result.video_url) : `/api/video/${encodeURIComponent(result.video_id)}`}
                            controls
                            playsInline
                            preload="auto"
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: '100%',
                              borderRadius: 0,
                              objectFit: 'contain',
                              background: '#000',
                              zIndex: 2
                            }}
                            onTimeUpdate={(e) => {
                              setCurrentTime(e.currentTarget.currentTime);
                            }}
                            onPlay={() => startTracking()}
                            onPause={() => stopTracking()}
                            onError={(e) => {
                              const vid = e.currentTarget;
                              const fallback = `/api/video/${encodeURIComponent(result.video_id)}`;
                              if (vid.src !== fallback && !vid.src.endsWith(fallback)) {
                                console.warn('[Player] Direct video failed, attempting fallback to server stream:', fallback);
                                vid.src = fallback;
                                vid.load();
                              }
                            }}
                          />
                        ) : (
                          <div id="youtube-player-container" style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
                            <div id="youtube-player"></div>
                          </div>
                        )}
                        {subtitlesSource === 'manual' && currentSubtitle && (
                          <div className="video-subtitle-overlay">
                            <span>{currentSubtitle.text}</span>
                          </div>
                        )}
                      </div>

                      {/* Refresh Player control */}
                      {/* Player control buttons: Refresh Player & Download Raw Video */}
                      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.25rem', marginBottom: '0.25rem' }}>
                        <button
                          type="button"
                          className="form-input"
                          onClick={handleRefreshPlayer}
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.45rem',
                            fontSize: '0.78rem',
                            padding: '0.55rem 1rem',
                            borderRadius: 0,
                            cursor: 'pointer',
                            background: '#0a0a0f',
                            border: '1px solid #201e2c',
                            color: 'var(--text-primary)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            fontWeight: 600
                          }}
                        >
                          <RotateCw size={13} />
                          {t.results.refreshPlayer}
                        </button>

                        <button
                          type="button"
                          className="form-input glowing-btn"
                          onClick={handleDownloadRawVideo}
                          disabled={isDownloadingRaw}
                          title="Download full original YouTube video at highest 1080p resolution"
                          style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.45rem',
                            fontSize: '0.78rem',
                            padding: '0.55rem 1rem',
                            borderRadius: 0,
                            cursor: isDownloadingRaw ? 'not-allowed' : 'pointer',
                            background: 'rgba(0, 229, 255, 0.15)',
                            border: '1px solid #00e5ff',
                            color: '#00e5ff',
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            fontWeight: 700
                          }}
                        >
                          {isDownloadingRaw ? (
                            <>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon" style={{ animation: 'spin 1s linear infinite' }}>
                                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                              </svg>
                              {t.results.downloadingRawVideo}
                            </>
                          ) : (
                            <>
                              <Download size={13} />
                              {t.results.downloadRawVideo}
                            </>
                          )}
                        </button>
                      </div>

                      {/* Raw Video Download Real-time Progress Bar */}
                      {rawDownloadProgress && (
                        <div className="raw-download-progress-card">
                          <div className="progress-card-header">
                            <span className="progress-card-title">
                              {rawDownloadProgress.status === 'ready' ? (
                                <span style={{ color: '#4ade80' }}>[OK] {t.rawDownload.readyBadge}</span>
                              ) : (
                                <>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon">
                                    <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                                  </svg>
                                  <span>{t.rawDownload.downloadingTitle(rawDownloadProgress.percent.toFixed(1))}</span>
                                </>
                              )}
                            </span>
                            {rawDownloadProgress.eta && rawDownloadProgress.status !== 'ready' && (
                              <span className="progress-card-eta">{t.rawDownload.eta(rawDownloadProgress.eta)}</span>
                            )}
                          </div>
                          <div className="progress-track">
                            <div
                              className="progress-fill-bar"
                              style={{
                                width: `${Math.min(100, Math.max(0, rawDownloadProgress.percent))}%`,
                                background: rawDownloadProgress.status === 'ready' ? 'linear-gradient(90deg, #22c55e 0%, #4ade80 100%)' : undefined
                              }}
                            />
                          </div>
                          <div className="progress-card-meta">
                            <span>
                              {rawDownloadProgress.downloaded || t.rawDownload.connecting} {rawDownloadProgress.total ? `/ ${rawDownloadProgress.total}` : ''}
                            </span>
                            <span>{rawDownloadProgress.speed || ''}</span>
                          </div>
                        </div>
                      )}

                      {/* Heatmap Timeline component */}
                      <HeatmapTimeline
                        duration={result.duration}
                        heatmap={result.heatmap}
                        signalSource={result.heatmap_source}
                        currentTime={currentTime}
                        onSeek={handleSeek}
                        activeClip={activeClip}
                      />
                    </div>

                    {/* AI Summary card */}
                    <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      <div>
                        <h3 style={{ fontSize: '1.05rem', color: 'var(--primary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.results.videoSummary}</h3>
                        {(() => {
                          const { text, hashtags } = extractHashtagsAndText(result.summary);
                          return (
                            <>
                              {hashtags.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
                                  {hashtags.map((tag, idx) => (
                                    <span
                                      key={idx}
                                      className="summary-hashtag-highlight"
                                      style={{
                                        color: 'var(--accent)',
                                        fontWeight: '600',
                                        background: 'rgba(16, 185, 129, 0.1)',
                                        padding: '2px 6px',
                                        borderRadius: 0,
                                        border: '1px solid rgba(16, 185, 129, 0.2)',
                                        fontSize: '0.75rem',
                                        display: 'inline-block'
                                      }}
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{text}</p>
                            </>
                          );
                        })()}
                      </div>

                      <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                          <h3 style={{ fontSize: '1.05rem', color: 'var(--secondary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {t.results.generatedClipsOverview(result.clips.length)}
                          </h3>
                          <div style={{ position: 'relative', display: 'inline-block' }}>
                            <button
                              type="button"
                              onClick={(e) => toggleTimestampMenu('overview', e)}
                              title={t.results.copyAllTimestampsTooltip}
                              style={{
                                fontSize: '0.72rem',
                                padding: '0.2rem 0.55rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.25rem',
                                borderRadius: 0,
                                background: copyTimestampMenuTarget === 'overview' ? 'rgba(255, 94, 58, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                border: `1px solid ${copyTimestampMenuTarget === 'overview' ? 'rgba(255, 94, 58, 0.5)' : 'var(--border-color)'}`,
                                color: copyTimestampMenuTarget === 'overview' ? 'var(--secondary)' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontWeight: 600,
                                transition: 'var(--transition-smooth)'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(255, 94, 58, 0.12)';
                                e.currentTarget.style.borderColor = 'rgba(255, 94, 58, 0.4)';
                                e.currentTarget.style.color = 'var(--secondary)';
                              }}
                              onMouseLeave={(e) => {
                                if (copyTimestampMenuTarget !== 'overview') {
                                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                                  e.currentTarget.style.borderColor = 'var(--border-color)';
                                  e.currentTarget.style.color = 'var(--text-secondary)';
                                }
                              }}
                            >
                              {t.results.copyAllTimestamps} ▼
                            </button>
                            {copyTimestampMenuTarget === 'overview' && renderTimestampFormatMenu('right')}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '250px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                          {result.clips.map((clip, idx) => {
                            const isSelected = activeClip?.start_time === clip.start_time && activeClip?.end_time === clip.end_time;
                            const clipKey = `${clip.start_time}_${clip.end_time}`;
                            const isMarked = !!markedClips[clipKey];
                            return (
                              <div
                                key={idx}
                                onClick={() => setActiveClip(clip)}
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  fontSize: '0.8rem',
                                  padding: '0.5rem',
                                  borderRadius: 0,
                                  background: isSelected
                                    ? 'rgba(255, 94, 58, 0.1)'
                                    : 'rgba(255, 255, 255, 0.02)',
                                  border: isSelected
                                    ? '1px solid var(--secondary)'
                                    : '1px solid transparent',
                                  cursor: 'pointer',
                                  transition: 'var(--transition-smooth)',
                                  opacity: 1
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, overflow: 'hidden' }}>
                                  <input
                                    type="checkbox"
                                    checked={isMarked}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      toggleMarkedClip(clipKey);
                                    }}
                                    style={{
                                      width: '14px',
                                      height: '14px',
                                      cursor: 'pointer',
                                      accentColor: 'var(--secondary)'
                                    }}
                                  />
                                  <span style={{
                                    fontWeight: 500,
                                    color: isMarked
                                      ? 'var(--secondary)'
                                      : (isSelected ? 'var(--text-primary)' : 'var(--text-secondary)'),
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                  }}>
                                    {idx + 1}. {clip.title}
                                  </span>
                                </div>
                                <div className="sidebar-clip-item-right">
                                  <span className={`virality-mini-badge ${clip.virality_score >= 85 ? 'score-high' : clip.virality_score >= 70 ? 'score-mid' : 'score-low'}`}>
                                    {clip.virality_score}/100
                                  </span>
                                  {clip.selection_reason && <details style={{fontSize:'0.8rem',color:'var(--text-muted)'}}><summary>{t.results.scoreDetails}</summary><p>{clip.selection_reason}</p><small>{clip.score_note}</small></details>}
                                  <span
                                    onClick={(e) => handleCopyTimestamp(clip, e)}
                                    title={t.results.copyTimestampTooltip}
                                    className="virality-mini-ts"
                                  >
                                    {formatSeconds(clip.start_time)} - {formatSeconds(clip.end_time)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>


</>;}

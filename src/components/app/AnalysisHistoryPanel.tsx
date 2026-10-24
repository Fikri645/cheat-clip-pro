import {
AlertTriangle,
Check,
ChevronDown,
ChevronUp,
Play,
Trash2,
X
} from 'lucide-react';
import type React from 'react';
import type { Translations } from '../../locales';
import { type HistoryEntry } from '../../utils/analysisHistory';
interface Props {history:HistoryEntry[];
setShowHistory:React.Dispatch<React.SetStateAction<boolean>>;
t:Translations;
historySearchQuery:string;
setHistorySearchQuery:React.Dispatch<React.SetStateAction<string>>;
confirmClearAll:boolean;
clearAllHistory:() => void;
setConfirmClearAll:React.Dispatch<React.SetStateAction<boolean>>;
showHistory:boolean;
filteredHistory:HistoryEntry[];
loadFromHistory:(entry: HistoryEntry) => void;
formatRelativeTime:(iso: string) => string;
deleteHistoryEntry:(entry: HistoryEntry, e: React.MouseEvent) => void;}
export function AnalysisHistoryPanel({history,setShowHistory,t,historySearchQuery,setHistorySearchQuery,confirmClearAll,clearAllHistory,setConfirmClearAll,showHistory,filteredHistory,loadFromHistory,formatRelativeTime,deleteHistoryEntry}:Props){return <>
            {/* Top-level Previously Analyzed Videos (History) Panel */}
            {history.length > 0 && (
              <section
                className="history-highlight-panel"
                aria-label="Previously analyzed clips"
                style={{ marginTop: 0, marginBottom: 0, borderRadius: 0, border: '1px solid #201e2c', borderLeft: '3px solid #ff00ff', background: '#0a0a0f' }}
              >
                {/* Header Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => setShowHistory(h => !h)}
                  >
                    <span style={{ fontSize: '1.4rem', color: '#ff00ff', textShadow: '0 0 10px rgba(255, 0, 255, 0.7)', fontFamily: 'var(--font-mono)', fontWeight: 800 }}>&gt;_</span>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {t.form.previouslyAnalyzed}
                        </h3>
                        <span style={{
                          background: 'rgba(255, 0, 255, 0.15)',
                          color: '#ff00ff',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          padding: '0.15rem 0.65rem',
                          borderRadius: 0,
                          border: '1px solid #ff00ff',
                          boxShadow: '0 0 8px rgba(255, 0, 255, 0.35)'
                        }}>
                          {history.length}
                        </span>
                      </div>
                      <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                        {t.form.historySubtitle}
                      </p>
                    </div>
                  </div>

                  {/* Actions: Search bar, Clear All, Collapse Toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {/* Search Bar */}
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <span style={{ position: 'absolute', left: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)', pointerEvents: 'none' }}>
                        &gt;
                      </span>
                      <input
                        type="text"
                        className="history-search-input"
                        placeholder={t.form.searchHistoryPlaceholder}
                        value={historySearchQuery}
                        onChange={(e) => setHistorySearchQuery(e.target.value)}
                        style={{ paddingRight: historySearchQuery ? '2rem' : '0.85rem', borderRadius: 0, background: '#08080c', border: '1px solid #201e2c', fontWeight: 400 }}
                      />
                      {historySearchQuery && (
                        <button
                          type="button"
                          onClick={() => setHistorySearchQuery('')}
                          style={{
                            position: 'absolute',
                            right: '0.6rem',
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            padding: 0
                          }}
                          title={t.form.clearSearch}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Clear all with confirmation */}
                    {confirmClearAll ? (
                      <div style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        background: 'rgba(255, 30, 39, 0.12)',
                        padding: '0.25rem 0.55rem',
                        borderRadius: 0,
                        border: '1px solid #ff1e27',
                        animation: 'fadeIn 0.2s ease',
                        boxShadow: '0 0 10px rgba(255, 30, 39, 0.25)'
                      }}>
                        <span style={{ fontSize: '0.74rem', color: '#ff1e27', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          <AlertTriangle size={13} color="#ff1e27" />
                          {t.form.areYouSure}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            clearAllHistory();
                            setConfirmClearAll(false);
                          }}
                          style={{
                            fontSize: '0.74rem',
                            color: '#fff',
                            background: '#ff1e27',
                            border: '1px solid #ff1e27',
                            borderRadius: 0,
                            padding: '0.25rem 0.55rem',
                            cursor: 'pointer',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem',
                            boxShadow: '0 2px 8px rgba(255, 30, 39, 0.4)'
                          }}
                        >
                          <Check size={12} /> {t.form.confirmClear}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmClearAll(false)}
                          style={{
                            fontSize: '0.74rem',
                            color: 'var(--text-secondary)',
                            background: 'rgba(255, 255, 255, 0.08)',
                            border: '1px solid rgba(255, 255, 255, 0.15)',
                            borderRadius: 0,
                            padding: '0.25rem 0.45rem',
                            cursor: 'pointer',
                            fontWeight: 500,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.25rem'
                          }}
                        >
                          <X size={12} /> {t.form.cancel}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmClearAll(true)}
                        style={{
                          fontSize: '0.75rem',
                          color: '#ff1e27',
                          background: 'rgba(255, 30, 39, 0.12)',
                          border: '1px solid #ff1e27',
                          borderRadius: 0,
                          padding: '0.45rem 0.75rem',
                          cursor: 'pointer',
                          fontWeight: 700,
                          transition: 'all 0.2s ease',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem'
                        }}
                      >
                        <Trash2 size={13} />
                        {t.form.clearAll}
                      </button>
                    )}

                    {/* Toggle button */}
                    <button
                      type="button"
                      onClick={() => setShowHistory(h => !h)}
                      style={{
                        background: '#08080c',
                        border: '1px solid #201e2c',
                        color: 'var(--text-secondary)',
                        borderRadius: 0,
                        padding: '0.45rem 0.7rem',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      title={showHistory ? "Minimize" : "Expand"}
                    >
                      {showHistory ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                  </div>
                </div>

                {/* Expanded content */}
                {showHistory && (
                  <div style={{ marginTop: '1.25rem' }}>
                    {historySearchQuery.trim() && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{t.form.showingHistoryCount(filteredHistory.length, history.length)}</span>
                        <button
                          type="button"
                          onClick={() => setHistorySearchQuery('')}
                          style={{ background: 'none', border: 'none', color: '#ff00ff', cursor: 'pointer', fontSize: '0.78rem', textDecoration: 'underline' }}
                        >
                          {t.form.clearSearch}
                        </button>
                      </div>
                    )}

                    {filteredHistory.length === 0 ? (
                      <div style={{
                        padding: '2rem 1rem',
                        textAlign: 'center',
                        background: 'rgba(255, 255, 255, 0.02)',
                        borderRadius: 0,
                        border: '1px dashed rgba(255, 255, 255, 0.1)'
                      }}>
                        <span style={{ fontSize: '1.75rem', display: 'block', marginBottom: '0.5rem', color: '#ff00ff' }}>&gt;_</span>
                        <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                          {t.form.noHistoryMatch}
                        </p>
                        {historySearchQuery && (
                          <button
                            type="button"
                            onClick={() => setHistorySearchQuery('')}
                            style={{
                              marginTop: '0.75rem',
                              fontSize: '0.78rem',
                              background: 'rgba(255, 0, 255, 0.15)',
                              border: '1px solid #ff00ff',
                              color: '#ff00ff',
                              borderRadius: 0,
                              padding: '0.35rem 0.8rem',
                              cursor: 'pointer'
                            }}
                          >
                            {t.form.clearSearch}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', maxHeight: '420px', overflowY: 'auto', paddingRight: '0.35rem' }}>
                        {filteredHistory.map((entry) => {
                          const q = historySearchQuery.trim().toLowerCase();
                          const matchedClip = q ? entry.clip_titles?.find(t => t.toLowerCase().includes(q)) : null;
                          const matchedQuote = (!matchedClip && q) ? entry.key_quotes?.find(k => k.toLowerCase().includes(q)) : null;

                          return (
                            <div
                              key={`${entry.video_id}_${entry.duration_pref}_${entry.range_suffix || ''}`}
                              className="history-entry-card"
                              onClick={() => loadFromHistory(entry)}
                              style={{ borderRadius: 0, background: '#08080c', border: '1px solid #201e2c' }}
                            >
                              {/* Thumbnail with overlay duration badge */}
                              <div style={{ position: 'relative', flexShrink: 0 }}>
                                <img
                                  src={entry.thumbnail}
                                  alt=""
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="84" height="48" viewBox="0 0 84 48"><rect width="84" height="48" fill="%2308080c"/><polygon points="36,18 52,24 36,30" fill="%23ff00ff"/></svg>';
                                  }}
                                  style={{ width: '84px', height: '48px', objectFit: 'cover', borderRadius: 0, background: '#111', display: 'block' }}
                                />
                                <span style={{
                                  position: 'absolute',
                                  bottom: '3px',
                                  right: '3px',
                                  background: 'rgba(0, 0, 0, 0.85)',
                                  color: '#fff',
                                  fontSize: '0.65rem',
                                  fontWeight: 700,
                                  padding: '0.1rem 0.3rem',
                                  borderRadius: 0,
                                  lineHeight: 1
                                }}>
                                  {entry.duration_pref === 'auto' ? 'Auto' : entry.duration_pref}
                                </span>
                              </div>

                              {/* Title and details */}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: '0.88rem',
                                  fontWeight: 600,
                                  color: 'var(--text-primary)',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis'
                                }}>
                                  {entry.title}
                                </div>
                                <div style={{ display: 'flex', gap: '0.65rem', marginTop: '0.25rem', fontSize: '0.74rem', color: 'var(--text-muted)', flexWrap: 'wrap', alignItems: 'center' }}>
                                  <span style={{ color: '#00ff66', fontWeight: 600 }}>{t.form.clipsCountMeta(entry.clip_count)}</span>
                                  <span>•</span>
                                  <span> {entry.duration_pref === 'auto' ? 'Auto' : entry.duration_pref}</span>
                                  <span>•</span>
                                  <span> {formatRelativeTime(entry.analyzed_at)}</span>
                                  <span>•</span>
                                  {entry.source_type === 'gdrive' ? (
                                    <a
                                      href={entry.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ color: '#00ff66', textDecoration: 'none', opacity: 0.9, fontWeight: 600 }}
                                    >
                                      -&gt; Google Drive
                                    </a>
                                  ) : entry.source_type === 'upload' ? (
                                    <span style={{ color: '#00e5ff', opacity: 0.9, fontWeight: 600 }}>
                                      [+] Local Video
                                    </span>
                                  ) : (
                                    <a
                                      href={entry.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      style={{ color: '#ff1e27', textDecoration: 'none', opacity: 0.9, fontWeight: 600 }}
                                    >
                                      -&gt; YouTube
                                    </a>
                                  )}
                                </div>

                                {/* Matched clip/quote search preview */}
                                {matchedClip && (
                                  <div style={{ fontSize: '0.72rem', color: '#ff00ff', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <span style={{ fontWeight: 600 }}>* {t.form.matchedClipLabel}:</span>
                                    <span style={{ fontStyle: 'italic', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>"{matchedClip}"</span>
                                  </div>
                                )}
                                {matchedQuote && (
                                  <div style={{ fontSize: '0.72rem', color: '#00e5ff', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                    <span style={{ fontWeight: 600 }}>// {t.form.matchedQuoteLabel}:</span>
                                    <span style={{ fontStyle: 'italic', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>"{matchedQuote}"</span>
                                  </div>
                                )}
                              </div>

                              {/* Action buttons */}
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); loadFromHistory(entry); }}
                                  style={{
                                    background: 'rgba(0, 229, 255, 0.15)',
                                    border: '1px solid #00e5ff',
                                    color: '#00e5ff',
                                    borderRadius: 0,
                                    padding: '0.35rem 0.75rem',
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.35rem'
                                  }}
                                >
                                  <Play size={12} fill="#00e5ff" />
                                  {t.form.loadVideo}
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => deleteHistoryEntry(entry, e)}
                                  style={{
                                    background: 'rgba(255, 30, 39, 0.12)',
                                    border: '1px solid rgba(255, 30, 39, 0.35)',
                                    color: '#ff1e27',
                                    borderRadius: 0,
                                    padding: '0.35rem 0.55rem',
                                    cursor: 'pointer',
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                  }}
                                  title={t.form.removeFromHistory}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}


</>;}

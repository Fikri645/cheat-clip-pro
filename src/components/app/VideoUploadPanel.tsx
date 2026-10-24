import type React from 'react';
import type { Translations } from '../../locales';
interface Props {sourceMode:"youtube" | "gdrive" | "upload";
videoFileInputRef:React.RefObject<HTMLInputElement | null>;
setUploadedVideoFile:React.Dispatch<React.SetStateAction<File | null>>;
setUploadedVideoInfo:React.Dispatch<React.SetStateAction<{ videoId: string; filename: string; savedName: string; duration: number; videoUrl: string; filePath: string; width: number; height: number; } | null>>;
setError:React.Dispatch<React.SetStateAction<string | null>>;
uploadedVideoFile:File|null;
uploadedVideoInfo:{ videoId: string; filename: string; savedName: string; duration: number; videoUrl: string; filePath: string; width: number; height: number; }|null;
setIsDragOverVideo:React.Dispatch<React.SetStateAction<boolean>>;
isDragOverVideo:boolean;
t:Translations;
loading:boolean;
isUploadingVideo:boolean;}
export function VideoUploadPanel({sourceMode,videoFileInputRef,setUploadedVideoFile,setUploadedVideoInfo,setError,uploadedVideoFile,uploadedVideoInfo,setIsDragOverVideo,isDragOverVideo,t,loading,isUploadingVideo}:Props){return <>
            {/* Upload Local Video mode */}
            {sourceMode === 'upload' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input
                  type="file"
                  ref={videoFileInputRef}
                  accept="video/*,.mp4,.mov,.mkv,.webm,.avi,.m4v"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setUploadedVideoFile(file);
                      setUploadedVideoInfo(null);
                      setError(null);
                    }
                  }}
                />

                {!uploadedVideoFile && !uploadedVideoInfo ? (
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragOverVideo(true);
                    }}
                    onDragLeave={() => setIsDragOverVideo(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragOverVideo(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) {
                        setUploadedVideoFile(file);
                        setUploadedVideoInfo(null);
                        setError(null);
                      }
                    }}
                    onClick={() => videoFileInputRef.current?.click()}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.85rem',
                      padding: '2.5rem 1.5rem',
                      borderRadius: 0,
                      border: isDragOverVideo ? '2px dashed #00e5ff' : '1px dashed rgba(0, 229, 255, 0.45)',
                      background: isDragOverVideo ? 'rgba(0, 229, 255, 0.15)' : 'rgba(0, 229, 255, 0.04)',
                      boxShadow: isDragOverVideo ? '0 0 20px rgba(0, 229, 255, 0.35)' : 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    <div style={{
                      width: '56px',
                      height: '56px',
                      borderRadius: 0,
                      background: 'rgba(0, 229, 255, 0.12)',
                      border: '1px solid #00e5ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#00e5ff',
                      boxShadow: '0 0 12px rgba(0, 229, 255, 0.35)'
                    }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="23 7 16 12 23 17 23 7"></polygon>
                        <rect x="1" y="5" width="15" height="14" rx="0" ry="0"></rect>
                      </svg>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '1rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.25rem' }}>
                        {t.form.dropVideoTitle}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {t.form.dropVideoSubtitle}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="action-link-btn"
                      style={{
                        marginTop: '0.25rem',
                        padding: '0.45rem 1.2rem',
                        borderRadius: 0,
                        background: 'rgba(0, 229, 255, 0.15)',
                        border: '1px solid #00e5ff',
                        color: '#00e5ff',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono)',
                        boxShadow: '0 0 10px rgba(0, 229, 255, 0.3)'
                      }}
                    >
                      {t.form.chooseVideoFile}
                    </button>
                  </div>
                ) : (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '1.25rem 1.5rem',
                    borderRadius: 0,
                    background: 'rgba(0, 229, 255, 0.08)',
                    border: '1px solid #00e5ff',
                    boxShadow: '0 0 12px rgba(0, 229, 255, 0.2)',
                    flexWrap: 'wrap',
                    gap: '1rem'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
                      <div style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: 0,
                        background: 'rgba(59, 130, 246, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#60a5fa',
                        flexShrink: 0
                      }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="23 7 16 12 23 17 23 7"></polygon>
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                        </svg>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{
                          fontSize: '0.95rem',
                          fontWeight: 600,
                          color: 'var(--text-primary)',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {uploadedVideoFile?.name || uploadedVideoInfo?.filename}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem', alignItems: 'center' }}>
                          {uploadedVideoFile && (
                            <span>[PKG] {(uploadedVideoFile.size / (1024 * 1024)).toFixed(1)} MB</span>
                          )}
                          {uploadedVideoInfo && uploadedVideoInfo.duration > 0 && (
                            <span> {Math.round(uploadedVideoInfo.duration)}s</span>
                          )}
                          <span>•</span>
                          <span style={{ color: '#10b981', fontWeight: 600 }}>* Whisper AI Auto-Transcribe</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setUploadedVideoFile(null);
                          setUploadedVideoInfo(null);
                          if (videoFileInputRef.current) videoFileInputRef.current.value = '';
                        }}
                        disabled={loading}
                        style={{
                          padding: '0.5rem 1rem',
                          borderRadius: 0,
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: 'var(--text-secondary)',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          cursor: 'pointer'
                        }}
                      >
                        {t.form.changeVideo}
                      </button>
                      <button
                        id="analyze-uploaded-btn"
                        type="submit"
                        className="glowing-btn"
                        disabled={loading || isUploadingVideo}
                        style={{ height: '42px', padding: '0 2rem' }}
                      >
                        {isUploadingVideo ? (
                          <>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon" style={{ animation: 'spin 1s linear infinite' }}>
                              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                            </svg>
                            {t.form.uploadingVideo}
                          </>
                        ) : loading ? (
                          <>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="spinner-icon" style={{ animation: 'spin 1s linear infinite' }}>
                              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"></circle>
                            </svg>
                            {t.form.processing}
                          </>
                        ) : (
                          <>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <polygon points="5 3 19 12 5 21 5 3"></polygon>
                            </svg>
                            {t.form.hackClips}
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}


</>;}

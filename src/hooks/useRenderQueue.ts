import { useCallback,useEffect,useRef,useState } from 'react';
import { renderClientBatch } from '../services/clientBatch';
import { getRender,restoreRender } from '../services/workspaceStore';
import type { AnalyzeResponse,BatchRenderProgress,RenderSettings } from '../types';
import { getStoredCookies,hasStoredCookies } from '../utils/cookieUtils';
import { isMobileDevice,releaseWakeLock,requestWakeLock } from '../utils/deviceUtils';
import { getErrorMessage } from '../utils/errors';
interface QueueOptions { result:AnalyzeResponse|null; url:string; sourceMode:'youtube'|'upload'|'gdrive'; uploadedVideoFile:File|null; loading:boolean; onCookieWarning:(proceed:()=>void)=>void }
export function useRenderQueue({result,url,sourceMode,uploadedVideoFile,loading,onCookieWarning}:QueueOptions) {
  // Own the stream and browser encoder for this screen.
  const [batchProgress, setBatchProgress] = useState<BatchRenderProgress | null>(null);
  const [isLaunchingRender, setIsLaunchingRender] = useState(false);
  const batchEventSourceRef = useRef<EventSource | null>(null);
  const clientAbortRef=useRef<AbortController|null>(null);
  const clientRenderRef = useRef<{settings:RenderSettings;result:AnalyzeResponse;file:File|null}|null>(null);

  const listenToBatchProgress = useCallback((batchId: string) => {
    if (batchEventSourceRef.current) {
      batchEventSourceRef.current.close();
      batchEventSourceRef.current = null;
    }
    localStorage.setItem('cheat_clip_active_batch', batchId);
    localStorage.setItem('cheat_clip_last_batch', batchId);
    const eventSource = new EventSource(`/api/render-progress/${batchId}`);
    batchEventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const progressData: BatchRenderProgress = JSON.parse(event.data);
        setBatchProgress(progressData);
        if (progressData.overall_status === 'completed' || progressData.overall_status === 'error' || progressData.overall_status === 'cancelled') {
          localStorage.removeItem('cheat_clip_active_batch');
          eventSource.close();
          if (batchEventSourceRef.current === eventSource) {
            batchEventSourceRef.current = null;
          }
        }
      } catch (err) {
        console.error('Failed to parse progress SSE:', err);
      }
    };

    eventSource.onerror = () => {
      // Keep EventSource open so its native retry recovers transient network loss.
      void fetch(`/api/render-batch/${batchId}`).then(async response => {
        if (batchEventSourceRef.current !== eventSource) return;
        if (response.status === 404) {
          eventSource.close(); batchEventSourceRef.current = null;
          localStorage.removeItem('cheat_clip_active_batch');
          localStorage.removeItem('cheat_clip_last_batch');
        } else if (response.ok) {
          const snapshot: BatchRenderProgress = await response.json();
          setBatchProgress(snapshot);
          if (!['running','cancelling'].includes(snapshot.overall_status)) {
            eventSource.close(); batchEventSourceRef.current = null;
            localStorage.removeItem('cheat_clip_active_batch');
          }
        }
      }).catch(() => { /* The existing stream retries when the server returns. */ });
    };
  }, []);

  useEffect(() => {
    const batchId = localStorage.getItem('cheat_clip_active_batch') || localStorage.getItem('cheat_clip_last_batch');
    if(batchId?.startsWith('client_')){void getRender(batchId).then(saved=>{if(saved)setBatchProgress(restoreRender(saved));});}
    else if (batchId) listenToBatchProgress(batchId);
  }, [listenToBatchProgress]);

  // Close SSE connection on unmount and handle mobile tab visibility reconnection
  const activeBatchIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (batchProgress?.overall_status === 'running') {
      activeBatchIdRef.current = batchProgress.batch_id;
      requestWakeLock();
    } else {
      activeBatchIdRef.current = null;
      if (!loading) {
        releaseWakeLock();
      }
    }
  }, [batchProgress?.overall_status, batchProgress?.batch_id, loading]);

  useEffect(() => {
    if (loading) {
      requestWakeLock();
    } else if (batchProgress?.overall_status !== 'running') {
      releaseWakeLock();
    }
  }, [loading, batchProgress?.overall_status]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const runningBatchId = activeBatchIdRef.current;
        if (runningBatchId && !runningBatchId.startsWith('client_')) {
          listenToBatchProgress(runningBatchId);
        }
        if (loading || activeBatchIdRef.current) {
          requestWakeLock();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (batchEventSourceRef.current) {
        batchEventSourceRef.current.close();
        batchEventSourceRef.current = null;
      }
      releaseWakeLock();
    };
  }, [listenToBatchProgress, loading]);

  useEffect(()=>()=>clientAbortRef.current?.abort(),[]);

  const isCurrentVideoYouTube = useCallback(() => {
    if (sourceMode === 'upload' || sourceMode === 'gdrive') return false;
    if (result?.source_type === 'upload' || result?.source_type === 'gdrive') return false;
    if (result?.video_id?.startsWith('upload_') || result?.video_id?.startsWith('gdrive_')) return false;
    if (result?.video_url?.includes('/api/video/')) return false;
    return true;
  }, [sourceMode, result?.source_type, result?.video_id, result?.video_url]);

  const handleStartBatchRender = async (settings: RenderSettings, forceProceed = false) => {
    if (!result) return;

    if (!forceProceed && isCurrentVideoYouTube() && !hasStoredCookies()) {
      const skipped = sessionStorage.getItem('cheatclip_skip_cookie_warning') === 'true';
      if (!skipped) {
        onCookieWarning(() => { void handleStartBatchRender(settings, true); });
        return;
      }
    }

    setIsLaunchingRender(true);

    const isClientMode = !isMobileDevice() && (settings.hardwareAccel === 'browser_wasm' || settings.hardwareAccel === 'client_gpu' || settings.renderEngine === 'client' || (sourceMode === 'upload' && Boolean(uploadedVideoFile)));

    if (isClientMode) {
      try {
        setIsLaunchingRender(false);
        clientRenderRef.current={settings,result,file:sourceMode==='upload'?uploadedVideoFile:null};
        const controller=new AbortController();clientAbortRef.current=controller;
        await renderClientBatch(settings, result, sourceMode === 'upload' ? uploadedVideoFile : null, progress=>{localStorage.setItem('cheat_clip_last_batch',progress.batch_id);setBatchProgress(progress);},undefined,undefined,controller.signal);
      } finally { setIsLaunchingRender(false); }
      return;
    }

    try {
      const userCookies = getStoredCookies();
      const resp = await fetch('/api/render-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_url: (result.video_url && !result.video_url.startsWith('blob:'))
            ? result.video_url
            : (result.video_id?.startsWith('upload_') || result.video_id?.startsWith('gdrive_'))
              ? `/api/video/${result.video_id}`
              : url || `https://www.youtube.com/watch?v=${result.video_id}`,
          video_id: result.video_id,
          clips: settings.selectedClips,
          cookies: userCookies || undefined,
          settings: {
            aspect_ratio: settings.aspectRatio,
            background_style: settings.backgroundStyle,
            enable_face_tracking: settings.enableFaceTracking,
            streamer_preset: settings.streamerPreset,
            facecam_position: settings.facecamPosition || 'auto',
            title_text: settings.titleText,
            title_prefix: settings.titlePrefix || '',
            title_suffix: settings.titleSuffix || '',
            file_name_prefix: settings.fileNamePrefix || '',
            file_name_suffix: settings.fileNameSuffix || '',
            title_position: settings.titlePosition,
            title_duration: settings.titleDuration || 'entire',
            subtitles_enabled: settings.captionStyle !== 'none',
            caption_style: settings.captionStyle,
            caption_font: settings.captionFont,
            title_font: settings.titleFont || settings.captionFont || 'Outfit',
            font_size: settings.fontSize,
            title_font_size: settings.titleFontSize || settings.fontSize || 'medium',
            font_size_px: settings.fontSizePx,
            title_font_size_px: settings.titleFontSizePx,
            text_case: settings.textCase,
            title_text_case: settings.titleTextCase || settings.textCase,
            title_y_percent: settings.titleYPercent,
            subtitle_y_percent: settings.subtitleYPercent,
            subtitle_position_mode: settings.subtitlePositionMode || 'bottom',
            subtitle_center_y_percent: settings.subtitleCenterYPercent !== undefined ? settings.subtitleCenterYPercent : 50.0,
            // Background Music
            bgm_enabled: settings.bgmEnabled || false,
            bgm_file_path: settings.bgmFilePath || null,
            bgm_volume: settings.bgmVolume !== undefined ? settings.bgmVolume : 25.0,
            bgm_start_offset: settings.bgmStartOffset || 0.0,
            // Hook SFX
            hook_sfx_enabled: settings.hookSfxEnabled || false,
            hook_sfx_file_path: settings.hookSfxFilePath || null,
            hook_sfx_volume: settings.hookSfxVolume !== undefined ? settings.hookSfxVolume : 100.0,
            // Raw Voice Audio Boost
            original_audio_volume: settings.originalAudioVolume !== undefined ? settings.originalAudioVolume : 100.0,
            // Watermark
            watermark_enabled: settings.watermarkEnabled || false,
            watermark_type: settings.watermarkType || 'image',
            watermark_file_path: settings.watermarkFilePath || null,
            watermark_text: settings.watermarkText || null,
            watermark_size: settings.watermarkSize !== undefined ? settings.watermarkSize : 20.0,
            watermark_opacity: settings.watermarkOpacity !== undefined ? settings.watermarkOpacity : 80.0,
            watermark_x: settings.watermarkX !== undefined ? settings.watermarkX : 90.0,
            watermark_y: settings.watermarkY !== undefined ? settings.watermarkY : 8.0,
            // Hardware Acceleration / Encoder
            hardware_accel: settings.hardwareAccel || 'auto',
            // Multi-Segment Merged Highlight Video
            render_mode: settings.renderMode || 'separate',
            compilation_title: settings.compilationTitle || null,
          },
          transcript: result.transcript,
        }),
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to start batch render job');
      }

      const data = await resp.json();
      const batchId = data.batch_id;

      // Initialize inline batch progress on the side under live preview (no modal)
      const isMerged = settings.renderMode === 'merged';
      setBatchProgress({
        video_id:result.video_id,
        batch_id: batchId,
        total_clips: isMerged ? 1 : settings.selectedClips.length,
        current_clip_index: 0,
        overall_status: 'running',
        clips: isMerged ? [{
          clip_index: 0,
          title: settings.compilationTitle || (settings.selectedClips[0]?.title_suggestion || settings.selectedClips[0]?.title || 'Highlight Compilation') + ` (${settings.selectedClips.length} Segments)`,
          status: 'pending',
          progress_percent: 0,
        }] : settings.selectedClips.map((c, i) => {
          const base = (c.title_suggestion || c.title || `Clip #${i + 1}`).trim();
          const pfx = settings.titlePrefix || '';
          const sfx = settings.titleSuffix || '';
          const fullTitle = (pfx || sfx) ? `${pfx}${base}${sfx}`.trim() : base;
          return {
            clip_index: i,
            title: fullTitle,
            status: 'pending',
            progress_percent: 0,
          };
        })
      });

      // Listen to SSE progress
      listenToBatchProgress(batchId);
    } catch (err) {
      alert(getErrorMessage(err) || 'Error launching batch render');
    } finally {
      setIsLaunchingRender(false);
    }
  };

  const handleRetryBatchClip = async (clipIndex?: number) => {
    if (!batchProgress?.batch_id) return;
    const batchId = batchProgress.batch_id;
    if(batchId.startsWith('client_')) {
      let source=clientRenderRef.current;
      if(!source){const saved=await getRender(batchId);if(saved?.context)source={...saved.context,result:result?.video_id===saved.context.result.video_id?result:saved.context.result,file:uploadedVideoFile};}
      if(!source) {alert('Reopen the source video to retry this browser render.');return;}
      const controller=new AbortController();clientAbortRef.current=controller;
      await renderClientBatch(source.settings,source.result,source.file,setBatchProgress,batchProgress,clipIndex!==undefined?[clipIndex]:undefined,controller.signal);
      return;
    }
    const previousProgress=batchProgress;

    try {
      // Optimistically update the UI to show 'pending' / retrying state for selected clip(s)
      setBatchProgress(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          overall_status: 'running',
          clips: prev.clips.map(c => {
            if (clipIndex === undefined || c.clip_index === clipIndex) {
              if (c.status === 'error' || c.status === 'pending') {
                return { ...c, status: 'pending', progress_percent: 0, error: undefined };
              }
            }
            return c;
          })
        };
      });

      const userCookies = getStoredCookies();
      const resp = await fetch(`/api/render-batch/${batchId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clip_indices: clipIndex !== undefined ? [clipIndex] : undefined,
          cookies: userCookies || undefined,
        }),
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to retry rendering');
      }

      // Reconnect SSE to track retry progress
      listenToBatchProgress(batchId);
    } catch (err) {
      setBatchProgress(previousProgress);
      alert(getErrorMessage(err) || 'Error retrying clip rendering');
    }
  };

  const cancelRender=async()=>{
    if(!batchProgress || !['running','cancelling'].includes(batchProgress.overall_status))return;
    if(batchProgress.batch_id.startsWith('client_'))clientAbortRef.current?.abort();
    else {
      const response=await fetch(`/api/render-batch/${batchProgress.batch_id}/cancel`,{method:'POST'});
      if(!response.ok)throw new Error('Could not cancel render');
      setBatchProgress(await response.json());
    }
  };
  return {batchProgress,setBatchProgress,isLaunchingRender,batchEventSourceRef,handleStartBatchRender,handleRetryBatchClip,cancelRender,isCurrentVideoYouTube};
}

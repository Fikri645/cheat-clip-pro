import { AlertTriangle,Check,Copy,RefreshCw } from 'lucide-react';
import React,{ useState } from 'react';
import type { Translations } from '../../locales';
function getFriendlyErrorMessage(rawMsg: string): string {
  if (!rawMsg) return 'Rendering failed unexpectedly.';
  const lower = rawMsg.toLowerCase();
  if (lower.includes("moov atom not found")) {
    return 'Download interrupted by internet lag ("moov atom not found"). The video stream was cut off before finishing. Click "[~] Retry" to re-download.';
  }
  if (lower.includes("bot verification") || lower.includes("sign in") || lower.includes("confirm you're not a bot")) {
    return 'YouTube requires cookies verification. Click the [*] Cookies Manager button in the top navbar to save your YouTube cookies.';
  }
  if (lower.includes("rendering timed out") || (lower.includes("timed out") && lower.includes("rendering"))) {
    return 'Video rendering timed out due to duration/complexity. Click "[~] Retry" or switch to Universal CPU encoder in Studio Settings.';
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return 'Video download timed out due to slow/laggy internet connection. Click "[~] Retry" to try downloading again.';
  }
  if (lower.includes("hardware encoder") || (lower.includes("ffmpeg") && (lower.includes("nvenc") || lower.includes("amf") || lower.includes("qsv")))) {
    return 'GPU hardware encoder failed. Please switch Video Encoder to "Universal CPU (libx264)" in Studio Settings.';
  }
  if (lower.includes("no space left") || lower.includes("disk full") || lower.includes("out of disk")) {
    return 'Disk storage is full. Please click "[x] Clear Temp" to free up storage space.';
  }
  if (lower.includes("whisper") || lower.includes("transcribe")) {
    return 'Word transcription failed. Check your audio track or switch subtitle style to none.';
  }
  if (lower.includes("ffmpeg") || lower.includes("filter_complex")) {
    return 'FFmpeg video rendering failed during composition. Check error details below.';
  }
  return rawMsg.length > 140 ? rawMsg.slice(0, 140) + '...' : rawMsg;
}

export const ClipRenderErrorBox: React.FC<{ errorMessage: string; t: Translations; onRetry?: () => void }> = ({ errorMessage, t, onRetry }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(errorMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const friendly = getFriendlyErrorMessage(errorMessage);

  return (
    <div
      style={{
        marginTop: '0.4rem',
        padding: '0.55rem 0.75rem',
        background: 'rgba(255, 30, 39, 0.12)',
        border: '1px solid #ff1e27',
        borderRadius: 0,
        fontSize: '0.72rem',
        color: '#fca5a5',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
        lineHeight: 1.4,
        wordBreak: 'break-word',
        boxShadow: '0 0 10px rgba(255, 30, 39, 0.25)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
          <AlertTriangle size={15} color="#ff1e27" style={{ flexShrink: 0, marginTop: '1px' }} />
          <span style={{ fontWeight: 700, color: '#fff' }}>{friendly}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
          {onRetry && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              style={{
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                border: '1px solid rgba(245, 158, 11, 0.6)',
                borderRadius: 0,
                color: '#ffffff',
                fontSize: '0.65rem',
                padding: '2px 8px',
                cursor: 'pointer',
                fontWeight: 700,
                transition: 'all 0.2s ease',
                boxShadow: '0 0 8px rgba(245, 158, 11, 0.35)',
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
          <button
            type="button"
            onClick={handleCopy}
            style={{
              background: copied ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.08)',
              border: `1px solid ${copied ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.15)'}`,
              borderRadius: 0,
              color: copied ? '#34d399' : '#e2e8f0',
              fontSize: '0.65rem',
              padding: '2px 7px',
              cursor: 'pointer',
              fontWeight: 600,
              transition: 'all 0.2s ease',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem'
            }}
            title="Copy full error details"
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? (t.studio.copiedErrorBtn || 'Copied!') : (t.studio.copyErrorBtn || 'Copy')}
          </button>
        </div>
      </div>

      <details style={{ fontSize: '0.67rem', color: '#94a3b8', marginTop: '0.15rem' }}>
        <summary style={{ cursor: 'pointer', color: '#cbd5e1', userSelect: 'none', fontWeight: 500 }}>
          {t.studio.errorDetails || 'Technical Log Details'}
        </summary>
        <pre
          style={{
            margin: '0.35rem 0 0 0',
            padding: '0.4rem 0.55rem',
            background: 'rgba(0, 0, 0, 0.55)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '4px',
            color: '#f87171',
            fontSize: '0.65rem',
            fontFamily: 'Consolas, Monaco, monospace',
            whiteSpace: 'pre-wrap',
            maxHeight: '130px',
            overflowY: 'auto',
          }}
        >
          {errorMessage}
        </pre>
      </details>
    </div>
  );
};

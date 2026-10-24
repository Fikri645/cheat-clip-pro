export interface AnalysisCacheContext {
  provider: 'gemini' | 'openrouter';
  model: string;
  duration: string;
  clipCount: number | 'auto';
  prompt: string;
  rangeStart?: number;
  rangeEnd?: number;
  subtitleSource: 'youtube' | 'manual';
  subtitleContent: string;
  transcriptLanguage: string;
  mode: 'live' | 'mock';
}

/** Versioned semantic identity. Never include API keys or cookies in cache keys. */
export async function analysisCacheKey(videoId: string, context: AnalysisCacheContext): Promise<string> {
  const canonical = JSON.stringify([
    2, context.provider, context.model, context.duration, context.clipCount,
    context.prompt.trim(), context.rangeStart ?? null, context.rangeEnd ?? null,
    context.subtitleSource,
    context.subtitleSource === 'manual' ? context.subtitleContent.replace(/\r\n?/g, '\n').trim() : '',
    context.subtitleSource === 'youtube' ? context.transcriptLanguage : '', context.mode,
  ]);
  const bytes = new TextEncoder().encode(canonical);
  // WebCrypto digest is unavailable on plain HTTP LAN installations.
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    : (await import('@noble/hashes/sha2.js')).sha256(bytes);
  const hash = Array.from(digest, n => n.toString(16).padStart(2, '0')).join('');
  return `cheat_clip_cache_${videoId}_${context.duration}_v2_${hash}`;
}

export function analysisTimestampKey(cacheKey: string): string {
  return cacheKey.replace('cheat_clip_cache_', 'cheat_clip_ts_');
}

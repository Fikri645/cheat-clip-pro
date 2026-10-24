import type { AnalyzeResponse } from '../types';

export interface HistoryEntry {
    video_id: string;
    title: string;
    duration_pref: string;
    clip_count: number;
    analyzed_at: string;
    thumbnail: string;
    url: string;
    source_type?: 'youtube' | 'upload' | 'gdrive';
    video_url?: string;
    range_suffix?: string;
    summary?: string;
    clip_titles?: string[];
    key_quotes?: string[];
  }

export function readAnalysisHistory(): HistoryEntry[] {
  if(typeof localStorage==='undefined')return [];
    const entries: HistoryEntry[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('cheat_clip_cache_')) {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const data: AnalyzeResponse = JSON.parse(raw);

          if (!data || !data.video_id) continue;

          const video_id = data.video_id;
          const rest = key.substring('cheat_clip_cache_'.length);
          const suffix = rest.substring(video_id.length + 1); // skip video_id and trailing '_'
          const duration_pref = suffix.split('_')[0];
          const range_suffix = suffix.substring(duration_pref.length);

          // Try reading cached timestamp stored separately
          const tsKey = `cheat_clip_ts_${video_id}_${duration_pref}${range_suffix}`;
          const analyzed_at = localStorage.getItem(tsKey) || new Date().toISOString();
          const clip_titles = (data.clips || []).map((c) => c.title || '').filter(Boolean);
          const key_quotes = (data.clips || []).flatMap((c) => c.key_quotes || []).filter(Boolean);

          const isGDrive = data.source_type === 'gdrive' || video_id.startsWith('gdrive_');
          const isUpload = data.source_type === 'upload' || video_id.startsWith('upload_');
          const sourceType: 'youtube' | 'upload' | 'gdrive' = isGDrive ? 'gdrive' : (isUpload ? 'upload' : 'youtube');

          // Determine appropriate link and thumbnail
          let itemUrl = `https://www.youtube.com/watch?v=${video_id}`;
          if (isGDrive) {
            const gdriveIdMatch = video_id.match(/gdrive_([a-zA-Z0-9_-]+)/);
            const gdriveId = gdriveIdMatch ? gdriveIdMatch[1] : '';
            itemUrl = gdriveId ? `https://drive.google.com/file/d/${gdriveId}/view` : (data.video_url || '');
          } else if (isUpload) {
            itemUrl = data.video_url || `/api/video/${video_id}`;
          }

          const thumb = (isGDrive || isUpload)
            ? `/api/clip-frame?video_id=${encodeURIComponent(video_id)}&timestamp=2&video_url=${encodeURIComponent(data.video_url || itemUrl)}`
            : `https://img.youtube.com/vi/${video_id}/mqdefault.jpg`;

          entries.push({
            video_id,
            title: data.title,
            duration_pref,
            clip_count: data.clips?.length || 0,
            analyzed_at,
            thumbnail: thumb,
            url: itemUrl,
            source_type: sourceType,
            video_url: data.video_url,
            range_suffix,
            summary: data.summary || '',
            clip_titles,
            key_quotes
          });
        } catch {
          // Skip malformed entries
        }
      }
    }
    // Sort by most recent first
    entries.sort((a, b) => new Date(b.analyzed_at).getTime() - new Date(a.analyzed_at).getTime());
  return entries;
}

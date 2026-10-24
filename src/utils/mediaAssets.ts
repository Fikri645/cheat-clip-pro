export function mediaAssetUrl(path: string | undefined, kind: 'audio' | 'watermark'): string | undefined {
  if (!path) return;
  if (path.startsWith('blob:') || path.startsWith('/api/render-asset/')) return path;
  const name = decodeURIComponent(path.split('?')[0].replace(/\\/g, '/').split('/').pop() || '');
  if (kind === 'watermark') return `/api/watermark/${encodeURIComponent(name)}`;
  const token = btoa(String.fromCharCode(...new TextEncoder().encode(name))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  return `/api/render-asset/${token}`;
}

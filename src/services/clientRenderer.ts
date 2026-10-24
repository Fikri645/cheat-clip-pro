import type { BrowserRenderOptions } from './browserCompositor';
export type ClientRenderOptions = BrowserRenderOptions;
export async function getFFmpeg() {
  return (await import('./browserEncoder')).getFFmpeg();
}
export async function renderClipClientSide(options: BrowserRenderOptions): Promise<Blob> {
  const {encodeBrowser,encodeRawBrowser}=await import('./browserEncoder');
  return options.settings ? encodeBrowser(options,'wasm') : encodeRawBrowser(options);
}
export function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.mp4') ? filename : `${filename}.mp4`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

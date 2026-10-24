import type { BrowserRenderOptions } from './browserCompositor';
export type WebCodecsRenderOptions = BrowserRenderOptions;
export function isWebCodecsGpuSupported(): boolean {
  return typeof window !== 'undefined' && typeof VideoEncoder === 'function' && typeof VideoDecoder === 'function';
}
export function getClientGpuName(): string {
  try {
    const canvas = document.createElement('canvas');
    // Try WebGL2 first, then WebGL1
    const gl = (canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl2') ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) return 'Browser GPU';
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      if (renderer) return cleanGpuName(renderer);
    }
    return 'Client Hardware GPU';
  } catch {
    return 'Client Hardware GPU';
  }
}

function cleanGpuName(raw: string): string {
  // e.g. "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "NVIDIA GeForce RTX 3060 Ti"
  let clean = raw.replace(/^ANGLE\s*\(/i, '').replace(/\)$/, '');
  const parts = clean.split(',');
  if (parts.length > 1) {
    clean = parts[1].trim();
  }
  clean = clean.split(' Direct3D')[0].split(' vs_')[0].split(' OpenGL')[0].split(' Vulkan')[0].trim();
  return clean || 'Hardware GPU';
}


export async function renderClipWebCodecs(options: BrowserRenderOptions): Promise<Blob> {
  const {encodeBrowser}=await import('./browserEncoder');
  return encodeBrowser(options,'gpu');
}

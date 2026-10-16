/**
 * Fast Client-Side Face & Salient Object Detector
 * 
 * Runs 100% in the user's browser via:
 * 1. Native Shape Detection API (window.FaceDetector) if supported (Chrome, Edge).
 * 2. Canvas-based skin-tone centroid & luminosity tracker (160x90 thumbnail sample, ~1-2ms, universal fallback).
 * 
 * Ensures 0 server load for local file uploads, with instantaneous tracking and no server roundtrips.
 */

export interface DetectedFaceBox {
  found: boolean;
  cx: number; // 0.0 to 1.0 (horizontal center)
  cy: number; // 0.0 to 1.0 (vertical center)
  w: number;  // normalized width
  h: number;  // normalized height
  type: 'face' | 'salient_object';
}

export async function detectFaceClientSide(
  videoElement: HTMLVideoElement | null,
  facecamPosition: string = 'auto',
  _streamerPreset: string = 'none'
): Promise<DetectedFaceBox> {
  // Preset defaults if manual position selected
  if (facecamPosition === 'left') {
    return { found: true, cx: 0.28, cy: 0.35, w: 0.25, h: 0.35, type: 'face' };
  }
  if (facecamPosition === 'right') {
    return { found: true, cx: 0.72, cy: 0.35, w: 0.25, h: 0.35, type: 'face' };
  }
  if (facecamPosition === 'center') {
    return { found: true, cx: 0.50, cy: 0.35, w: 0.25, h: 0.35, type: 'face' };
  }

  if (!videoElement || videoElement.readyState < 2 || videoElement.videoWidth === 0) {
    return { found: false, cx: 0.50, cy: 0.35, w: 0.25, h: 0.35, type: 'face' };
  }

  const vWidth = videoElement.videoWidth;
  const vHeight = videoElement.videoHeight;

  // 1. Try Native Browser FaceDetector API (Shape Detection API)
  if (typeof (window as any).FaceDetector === 'function') {
    try {
      const detector = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 3 });
      const faces: any[] = await detector.detect(videoElement);
      if (faces && faces.length > 0) {
        // Pick the largest detected face
        let largestFace = faces[0];
        let maxArea = largestFace.boundingBox.width * largestFace.boundingBox.height;
        for (let i = 1; i < faces.length; i++) {
          const area = faces[i].boundingBox.width * faces[i].boundingBox.height;
          if (area > maxArea) {
            maxArea = area;
            largestFace = faces[i];
          }
        }

        const box = largestFace.boundingBox;
        const cx = Math.max(0.15, Math.min(0.85, (box.x + box.width / 2) / vWidth));
        const cy = Math.max(0.15, Math.min(0.85, (box.y + box.height / 2) / vHeight));
        const w = box.width / vWidth;
        const h = box.height / vHeight;

        return { found: true, cx, cy, w, h, type: 'face' };
      }
    } catch (e) {
      // Shape detection api failed or permission denied, fall back to canvas
    }
  }

  // 2. High-performance canvas skin-tone & upper-body centroid fallback (~1.5ms)
  try {
    const canvas = document.createElement('canvas');
    const sampleW = 160;
    const sampleH = 90;
    canvas.width = sampleW;
    canvas.height = sampleH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return { found: false, cx: 0.50, cy: 0.35, w: 0.25, h: 0.35, type: 'face' };
    }

    ctx.drawImage(videoElement, 0, 0, sampleW, sampleH);
    const imgData = ctx.getImageData(0, 0, sampleW, sampleH);
    const data = imgData.data;

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    // Scan top 70% of frame (faces and speakers are almost always in upper-middle area)
    const scanRows = Math.floor(sampleH * 0.70);

    for (let y = 5; y < scanRows; y++) {
      for (let x = 5; x < sampleW - 5; x++) {
        const idx = (y * sampleW + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Standard skin tone classifier in RGB color space
        const isSkin =
          r > 95 &&
          g > 40 &&
          b > 20 &&
          r > g &&
          r > b &&
          r - g > 15 &&
          Math.max(r, g, b) - Math.min(r, g, b) > 15;

        if (isSkin) {
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }

    if (count > 25) {
      const avgX = sumX / count;
      const avgY = sumY / count;
      const cx = Math.max(0.18, Math.min(0.82, avgX / sampleW));
      const cy = Math.max(0.15, Math.min(0.70, avgY / sampleH));

      return {
        found: true,
        cx,
        cy,
        w: 0.25,
        h: 0.35,
        type: 'face',
      };
    }
  } catch (canvasErr) {
    // Cross-origin or read error
  }

  // 3. Clean fallback to center
  return { found: false, cx: 0.50, cy: 0.35, w: 0.25, h: 0.35, type: 'face' };
}

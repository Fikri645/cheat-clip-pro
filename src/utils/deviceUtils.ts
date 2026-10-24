/**
 * Device utilities for mobile detection and browser resource management.
 */

/**
 * Detects if the current user is visiting from a mobile device (phone or tablet).
 * Checks User Agent, touch capabilities, and screen width.
 */
export function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;

  const ua = navigator.userAgent || navigator.vendor || window.opera || '';
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const isSmallScreen = window.innerWidth <= 768;
  const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  return isMobileUA || (isSmallScreen && hasTouch);
}

/**
 * Screen WakeLock manager to keep screen alive during intensive
 * client decoding, audio analysis, or video rendering.
 */
let wakeLockSentinel: WakeLockSentinel | null = null;

export async function requestWakeLock(): Promise<void> {
  if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
    } catch {
      // Wake lock unsupported, rejected by battery saver, or tab in background
    }
  }
}

export async function releaseWakeLock(): Promise<void> {
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch {
      // Ignore release error
    } finally {
      wakeLockSentinel = null;
    }
  }
}

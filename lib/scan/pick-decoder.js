// pick-decoder — decide which QR decoder the useDoorScanner hook should
// use, kept in its own module so the choice can be exercised in a Node
// test without loading the whole React hook (which pulls in a live
// `navigator`, `MediaDevices`, and a real <video>).
//
// Priority:
//
//   1. window.BarcodeDetector  — the platform API. Fast, GPU-accelerated
//      on Chromium desktop + Android Chrome + iOS 17+ Safari when Apple
//      decides to enable it. When it's here we use it.
//
//   2. jsQR                    — pure-JS fallback. ~40KB, works on
//      literally every device with a camera and a canvas, including the
//      current pathological iPadOS 26 case where BarcodeDetector is
//      absent OR present-but-broken (returns [] forever). Slower per
//      frame than the native API but at 5fps on a 1280×720 frame that's
//      still comfortably under one tick.
//
// We do NOT fall through from BarcodeDetector to jsQR at runtime on a
// per-frame basis — that would double the CPU cost of every scan. We
// pick once at boot and stick with it. If BarcodeDetector is present
// but broken, staff can still hit Refresh and the caller can force the
// jsQR path via forceFallback (used by a future "scanner not seeing my
// QR?" button, not wired yet).

export const DECODER_NATIVE = 'native';   // uses window.BarcodeDetector
export const DECODER_JSQR = 'jsqr';       // uses jsQR + canvas
export const DECODER_NONE = 'none';       // no working decoder on this device

/**
 * Choose the decoder for a given environment.
 *
 * @param {object} env
 * @param {object|undefined} env.win  — the window object (or undefined during SSR)
 * @param {boolean|undefined} env.jsqrAvailable  — whether jsQR loaded successfully
 * @param {boolean|undefined} env.forceFallback  — force the jsQR path even if
 *                                                 BarcodeDetector exists
 * @returns {'native'|'jsqr'|'none'}
 */
export function pickDecoder({ win, jsqrAvailable, forceFallback } = {}) {
  if (!win) return DECODER_NONE; // SSR / test environment with no window at all
  const hasNative = typeof win.BarcodeDetector !== 'undefined';
  if (hasNative && !forceFallback) return DECODER_NATIVE;
  if (jsqrAvailable) return DECODER_JSQR;
  return DECODER_NONE;
}

/**
 * Human-friendly copy for the camera_error screen when no decoder is
 * available. Should almost never render now that jsQR is bundled — the
 * only path here is "jsQR failed to load", which effectively means the
 * whole bundle failed.
 */
export const NO_DECODER_MESSAGE =
  'QR scanning is not available on this device. Reload the page, or use the front-desk laptop.';

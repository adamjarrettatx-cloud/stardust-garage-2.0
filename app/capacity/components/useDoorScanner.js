'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { pickDecoder, DECODER_NATIVE, DECODER_JSQR, DECODER_NONE, NO_DECODER_MESSAGE } from '@/lib/scan/pick-decoder';

// useDoorScanner — the camera + QR-decode plumbing extracted from /capacity/scan
// so both the standalone iPad page and the embedded front-desk scanner behave
// identically. The visual layer (video element, reticle, result cards) stays
// in the caller; this hook owns the state machine that always tripped up the
// standalone client:
//
//   * Decoder picker: prefers window.BarcodeDetector (fast, native on Chrome
//     desktop / Android / iOS 17+ when Apple flips it on), falls back to jsQR
//     (pure JS, works everywhere including the iPad-in-the-wild case where
//     BarcodeDetector is missing or broken). See lib/scan/pick-decoder.js.
//   * getUserMedia({ facingMode: 'environment', width/height ideals }) + torch
//     capability probe.
//   * 5 fps scan loop (SCAN_INTERVAL_MS).
//   * 3s duplicate-token debounce so a QR that stays in frame does not fire
//     twice while staff decides.
//   * Suspend the loop whenever the caller says "we are showing a card now".
//   * Torch toggle that hides the button on the first device that lies about
//     supporting it.
//
// The caller passes:
//   enabled         — whether the loop should be running right now
//   onRawScan(raw)  — called with the raw string of every accepted QR
//   dedupeMs        — override for the duplicate-token window (defaults to 3s)
//
// Returns:
//   videoRef                — attach to a <video> element
//   phase                   — 'booting' | 'ready' | 'camera_error'
//   cameraErrorMessage      — human-friendly message when phase === 'camera_error'
//   torchSupported, torch, toggleTorch()
//   decoderKind             — 'native' | 'jsqr' | null before boot completes.
//                             Exposed so the caller can render a subtle badge
//                             ("fallback decoder") if it wants; not required.
//
// SERVER-UNSAFE: uses navigator, window, BarcodeDetector, HTMLCanvasElement.
// Only import from a client component ('use client').

export const SCAN_INTERVAL_MS = 200; // 5 fps — plenty for a stationary QR at arm's length
export const DEFAULT_DUPLICATE_WINDOW_MS = 3000;

export function useDoorScanner({ enabled, onRawScan, dedupeMs = DEFAULT_DUPLICATE_WINDOW_MS } = {}) {
  const videoRef = useRef(null);
  const detectorRef = useRef(null);        // BarcodeDetector instance when native
  const jsqrRef = useRef(null);            // jsQR function when fallback
  const canvasRef = useRef(null);          // offscreen canvas for jsQR frame grabs
  const streamRef = useRef(null);
  const scanLoopRef = useRef(null);
  const lastScanRef = useRef({ raw: null, at: 0 });

  const [phase, setPhase] = useState('booting'); // booting | ready | camera_error
  const [cameraErrorMessage, setCameraErrorMessage] = useState(null);
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [decoderKind, setDecoderKind] = useState(null); // 'native' | 'jsqr' | null

  // The scan tick. Kept as a ref-wrapping closure so the interval never has to
  // be re-created when the caller's onRawScan identity churns — otherwise the
  // 5fps loop would tear down and start up on every FrontDeskClient render.
  const onRawScanRef = useRef(onRawScan);
  useEffect(() => { onRawScanRef.current = onRawScan; }, [onRawScan]);

  const acceptRaw = useCallback((raw) => {
    if (typeof raw !== 'string' || !raw) return;
    // Debounce: same raw payload within dedupeMs is the same QR still in
    // frame, not a fresh guest. The caller can also stop the loop
    // (enabled=false) once it has shown a card, which is the primary defense.
    const now = Date.now();
    if (lastScanRef.current.raw === raw && now - lastScanRef.current.at < dedupeMs) {
      return;
    }
    lastScanRef.current = { raw, at: now };
    onRawScanRef.current?.(raw);
  }, [dedupeMs]);

  const scanTick = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState < 2) return; // HAVE_CURRENT_DATA — nothing to decode yet

    // Native path: BarcodeDetector reads the <video> element directly.
    if (detectorRef.current) {
      try {
        const codes = await detectorRef.current.detect(video);
        if (!codes || codes.length === 0) return;
        acceptRaw(codes[0].rawValue);
      } catch {
        // BarcodeDetector.detect() can throw on decode failures; that's a
        // "nothing found this frame", not an error. Swallow.
      }
      return;
    }

    // Fallback path: draw the current frame into an offscreen canvas, then
    // hand the raw pixel data to jsQR. Guarded by a lot of readyState checks
    // because the very first tick can fire before the video has any real
    // pixels to grab.
    const jsQR = jsqrRef.current;
    if (!jsQR) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvasRef.current = canvas;
    }
    // Resize only when the video's intrinsic size actually changes — creating
    // a fresh drawing buffer on every tick would tank battery life on the iPad.
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    try {
      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      // dontInvert: 'attemptBoth' catches both dark-on-light (paper printout,
      // most member badges) and light-on-dark (phone in dark-mode) codes at
      // the cost of a second pass on frames that would otherwise fail. Fine
      // at 5fps.
      const found = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (found && found.data) acceptRaw(found.data);
    } catch {
      // drawImage / getImageData can throw on the first frame if the video
      // element is not fully wired yet. Swallow.
    }
  }, [acceptRaw]);

  // Camera + detector boot. Runs once on mount; teardown stops the stream and
  // the interval so a route change does not leave the camera light on.
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (typeof window === 'undefined') {
        // No window at all (SSR). Nothing to do — the client-only render
        // will re-run this effect.
        return;
      }

      // Step 1: figure out which decoder we're going to use. If neither the
      // native API nor jsQR is available (jsQR failed to load), fall out to
      // the camera_error screen with a device-agnostic message.
      let jsQR = null;
      try {
        // Dynamic import so jsQR is chunk-split out of the front-desk bundle
        // for laptops that will never need it. This is a webpack code-split
        // point, not a network fetch — the chunk is bundled at build time.
        const mod = await import('jsqr');
        jsQR = mod?.default || mod;
      } catch {
        jsQR = null;
      }
      if (cancelled) return;

      const kind = pickDecoder({ win: window, jsqrAvailable: !!jsQR });
      if (kind === DECODER_NONE) {
        setCameraErrorMessage(NO_DECODER_MESSAGE);
        setPhase('camera_error');
        return;
      }

      if (kind === DECODER_NATIVE) {
        try {
          detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch {
          // Very rare: BarcodeDetector present but the constructor throws.
          // Try to fall through to jsQR before giving up.
          if (jsQR) {
            jsqrRef.current = jsQR;
            setDecoderKind(DECODER_JSQR);
          } else {
            setCameraErrorMessage(NO_DECODER_MESSAGE);
            setPhase('camera_error');
            return;
          }
        }
        if (!jsqrRef.current) setDecoderKind(DECODER_NATIVE);
      } else {
        jsqrRef.current = jsQR;
        setDecoderKind(DECODER_JSQR);
      }

      // Step 2: get the camera up. Same code as before.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // Autoplay + playsInline are required on iOS Safari for the video to
          // render at all without a user gesture.
          await video.play().catch(() => {});
        }

        const [videoTrack] = stream.getVideoTracks();
        if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
          const caps = videoTrack.getCapabilities();
          if (caps && 'torch' in caps) setTorchSupported(true);
        }

        setPhase('ready');
      } catch (err) {
        const name = err?.name || '';
        if (name === 'NotAllowedError') {
          setCameraErrorMessage(
            'Camera permission denied. Grant Safari/Chrome access to the camera, then reload.',
          );
        } else if (name === 'NotFoundError') {
          setCameraErrorMessage('No camera found on this device.');
        } else {
          setCameraErrorMessage('Camera could not start. Check permissions and reload.');
        }
        setPhase('camera_error');
      }
    }

    boot();

    return () => {
      cancelled = true;
      if (scanLoopRef.current) {
        clearInterval(scanLoopRef.current);
        scanLoopRef.current = null;
      }
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // Run / pause the scan loop based on the caller's enabled flag AND the
  // camera being ready. Turning it off is what stops us from re-firing while
  // a preview card is on screen.
  useEffect(() => {
    if (phase !== 'ready' || !enabled) {
      if (scanLoopRef.current) {
        clearInterval(scanLoopRef.current);
        scanLoopRef.current = null;
      }
      return undefined;
    }
    scanLoopRef.current = setInterval(scanTick, SCAN_INTERVAL_MS);
    return () => {
      if (scanLoopRef.current) {
        clearInterval(scanLoopRef.current);
        scanLoopRef.current = null;
      }
    };
  }, [phase, enabled, scanTick]);

  // Reset the debounce record whenever the loop is paused, so a re-enable
  // does not silently swallow the same code the last card was for.
  useEffect(() => {
    if (!enabled) {
      lastScanRef.current = { raw: null, at: 0 };
    }
  }, [enabled]);

  const toggleTorch = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return;
    const [track] = stream.getVideoTracks();
    if (!track) return;
    const next = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorch(next);
    } catch {
      // Some devices claim torch capability but reject the constraint. Hide
      // the button so we do not offer a broken control twice.
      setTorchSupported(false);
    }
  }, [torch]);

  return {
    videoRef,
    phase,
    cameraErrorMessage,
    torch,
    torchSupported,
    toggleTorch,
    decoderKind,
  };
}

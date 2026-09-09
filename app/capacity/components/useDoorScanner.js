'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// useDoorScanner — the camera + BarcodeDetector plumbing extracted from
// /capacity/scan so both the standalone iPad page and the embedded front-desk
// scanner behave identically. The visual layer (video element, reticle, result
// cards) stays in the caller; this hook owns the state machine that always
// tripped up the standalone client:
//
//   * BarcodeDetector feature-detect + graceful "camera unavailable" screen
//   * getUserMedia({ facingMode: 'environment', width/height ideals }) + torch
//     capability probe
//   * 5 fps scan loop (SCAN_INTERVAL_MS)
//   * 3s duplicate-token debounce so a QR that stays in frame does not fire
//     twice while staff decides
//   * suspend the loop whenever the caller says "we are showing a card now"
//   * torch toggle that hides the button on the first device that lies about
//     supporting it
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
//
// SERVER-UNSAFE: uses navigator, window, BarcodeDetector. Only import from a
// client component ('use client').

export const SCAN_INTERVAL_MS = 200; // 5 fps — plenty for a stationary QR at arm's length
export const DEFAULT_DUPLICATE_WINDOW_MS = 3000;

export function useDoorScanner({ enabled, onRawScan, dedupeMs = DEFAULT_DUPLICATE_WINDOW_MS } = {}) {
  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const streamRef = useRef(null);
  const scanLoopRef = useRef(null);
  const lastScanRef = useRef({ raw: null, at: 0 });

  const [phase, setPhase] = useState('booting'); // booting | ready | camera_error
  const [cameraErrorMessage, setCameraErrorMessage] = useState(null);
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  // The scan tick. Kept as a ref-wrapping closure so the interval never has to
  // be re-created when the caller's onRawScan identity churns — otherwise the
  // 5fps loop would tear down and start up on every FrontDeskClient render.
  const onRawScanRef = useRef(onRawScan);
  useEffect(() => { onRawScanRef.current = onRawScan; }, [onRawScan]);

  const scanTick = useCallback(async () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector) return;
    if (video.readyState < 2) return; // HAVE_CURRENT_DATA — nothing to decode yet

    try {
      const codes = await detector.detect(video);
      if (!codes || codes.length === 0) return;
      const raw = codes[0].rawValue;
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
    } catch {
      // BarcodeDetector.detect() can throw on decode failures; that's a
      // "nothing found this frame", not an error. Swallow.
    }
  }, [dedupeMs]);

  // Camera + detector boot. Runs once on mount; teardown stops the stream and
  // the interval so a route change does not leave the camera light on.
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
        setCameraErrorMessage(
          'This browser cannot scan QR codes. Update to iPadOS/iOS 17+ or use a Chromium-based browser.',
        );
        setPhase('camera_error');
        return;
      }

      try {
        detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        setCameraErrorMessage('QR scanning unavailable in this browser.');
        setPhase('camera_error');
        return;
      }

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
  };
}

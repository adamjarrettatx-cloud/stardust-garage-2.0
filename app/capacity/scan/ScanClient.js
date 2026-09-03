'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { extractPassTokenFromScan } from '@/lib/trial-pass';

// The iPad scanner UI. One giant camera view, one big result overlay, one
// button to reset. Everything else is out of the way on purpose — staff
// working the door do not read prose and do not want to look for a button.
//
// State machine (kept flat because there is only ever one card on screen):
//
//   idle           → camera is up, actively scanning, no card shown yet
//   scanning       → we saw a QR, we're POSTing /api/capacity/trial-pass/scan
//   result         → server responded; big card visible; scanning paused
//   camera_error   → getUserMedia refused or the browser has no BarcodeDetector
//
// A completed scan (allowed OR denied) shows the card and pauses the loop for
// 5 seconds, or until staff taps "Next guest". The pause matters — without it
// the same pass in view would re-scan 30 times a second and drown the server
// (and the on-screen card would flicker so fast it would be unreadable).
//
// The pass URL that buildPassUrl() produced is what most QRs carry, but the
// server endpoint takes the bare token. extractPassTokenFromScan() (tested in
// tests/trial-pass.test.mjs) does that conversion and also filters out every
// unrelated QR (Instagram, Wi-Fi, menus) before the network sees it, so those
// show up as "Not a Trial SDG Pass" instantly instead of a server round-trip.

const SCAN_INTERVAL_MS = 200; // 5 fps is plenty for a stationary QR at arm's length
const RESULT_HOLD_MS = 5000;  // how long the big card stays up before auto-reset
const DUPLICATE_WINDOW_MS = 3000; // ignore the same token within 3s (prevents double-scans)

export default function ScanClient() {
  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const streamRef = useRef(null);
  const scanLoopRef = useRef(null);
  const lastScanRef = useRef({ token: null, at: 0 });
  const resultTimerRef = useRef(null);

  const [phase, setPhase] = useState('booting'); // booting | idle | scanning | result | camera_error
  const [result, setResult] = useState(null); // { ok, result, guest, event, staffAction, reason }
  const [notAPassMessage, setNotAPassMessage] = useState(null);
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [bumpWarning, setBumpWarning] = useState(null);
  const [cameraErrorMessage, setCameraErrorMessage] = useState(null);

  // ---- Capacity bump ----
  //
  // Same pattern as /capacity/front-desk: on an allowed scan we fire a
  // check_in against /api/capacity/operation so the running count on every
  // other capacity page ticks up. Never blocks the result card — the guest
  // is already in. If the session is full or missing we surface a small
  // warning on the card so the manager knows to reconcile, matching the
  // laptop's behavior exactly.
  //
  // source: capacity_events.source has a CHECK constraint that only allows
  // front_door / exit_door / admin / system / unknown. Same choice the
  // front-desk laptop makes — group with front_door in the audit log, put
  // the distinction in the note field.
  const bumpCapacity = useCallback(async () => {
    try {
      const res = await fetch('/api/capacity/operation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'check_in',
          source: 'front_door',
          note: 'ipad scanner (trial-pass scan)',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.code === 'full') return 'At capacity — count not bumped.';
        if (json.code === 'no_session') return 'No active capacity session — count not bumped.';
        return 'Count not bumped: ' + (json.error || 'try again from /capacity/admin');
      }
      return null;
    } catch {
      return 'Count not bumped (network).';
    }
  }, []);

  // ---- Server round-trip ----
  const submitToken = useCallback(async (token) => {
    setPhase('scanning');
    try {
      const res = await fetch('/api/capacity/trial-pass/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({
          ok: false,
          result: 'error',
          reason: json.error || 'Scan failed. Try again.',
        });
        setPhase('result');
        return;
      }
      setResult(json);
      setPhase('result');

      // Fire the capacity bump only on allowed scans, in the background — do
      // not block the result card on it.
      if (json.result === 'allowed') {
        const warning = await bumpCapacity();
        if (warning) setBumpWarning(warning);
      }
    } catch {
      setResult({
        ok: false,
        result: 'error',
        reason: 'Network error. Try again.',
      });
      setPhase('result');
    }
  }, [bumpCapacity]);

  // ---- The scan loop ----
  //
  // Runs at 5fps (plenty for a stationary QR at arm's length), skips a scan
  // when the phase has moved past idle (avoids a race where the loop keeps
  // POSTing while a result card is showing), and de-dupes the same token
  // within a 3s window so a QR that stays in the frame does not fire twice.
  const scanTick = useCallback(async () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector) return;
    if (video.readyState < 2) return; // HAVE_CURRENT_DATA — nothing to decode yet

    try {
      const codes = await detector.detect(video);
      if (!codes || codes.length === 0) return;
      const raw = codes[0].rawValue;
      const token = extractPassTokenFromScan(raw);

      if (!token) {
        // Something was decoded, but it's not a pass QR. Surface a soft
        // "not a pass" notice for a second and keep scanning — the guest may
        // fumble to the right screen.
        setNotAPassMessage('Not a Trial SDG Pass — ask them to open sdgatx.com/pass link.');
        setTimeout(() => setNotAPassMessage(null), 1500);
        return;
      }

      // Debounce: same token within DUPLICATE_WINDOW_MS ms is a re-detection
      // of a QR that never left the frame, not a fresh guest.
      const now = Date.now();
      if (lastScanRef.current.token === token && now - lastScanRef.current.at < DUPLICATE_WINDOW_MS) {
        return;
      }
      lastScanRef.current = { token, at: now };
      submitToken(token);
    } catch {
      // BarcodeDetector.detect() can throw on decode failures; that's a
      // "nothing found this frame" not an error, so swallow it.
    }
  }, [submitToken]);

  // ---- Camera setup + teardown ----
  //
  // We only ever want the rear camera (facingMode: 'environment'). On an
  // iPad in the case, that is the world-facing camera the guest holds their
  // phone up to.
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      // 1. Does the browser have BarcodeDetector? Safari 17+ (iPadOS 17+) and
      //    Chromium-based browsers do. Older iPads do not — bail with a clear
      //    message rather than silently loading a 45KB polyfill.
      if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
        setCameraErrorMessage('This iPad browser cannot scan QR codes. Update to iPadOS 17 or newer, or use the front-desk laptop.');
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

      // 2. Camera. HTTPS is required for getUserMedia to succeed; the prod
      //    domain has it, dev at localhost:3000 is also treated as secure.
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

        // Torch (flashlight) support is per-track and only exists on some
        // cameras — check the capabilities before showing the button.
        const [videoTrack] = stream.getVideoTracks();
        if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
          const caps = videoTrack.getCapabilities();
          if (caps && 'torch' in caps) {
            setTorchSupported(true);
          }
        }

        setPhase('idle');
      } catch (err) {
        // NotAllowedError, NotFoundError, NotReadableError — all end here.
        const name = err?.name || '';
        if (name === 'NotAllowedError') {
          setCameraErrorMessage('Camera permission denied. Grant Safari access to the camera in Settings, then reload.');
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
      if (resultTimerRef.current) {
        clearTimeout(resultTimerRef.current);
        resultTimerRef.current = null;
      }
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // ---- Run / pause the scan loop based on phase ----
  useEffect(() => {
    if (phase !== 'idle') {
      if (scanLoopRef.current) {
        clearInterval(scanLoopRef.current);
        scanLoopRef.current = null;
      }
      return;
    }
    scanLoopRef.current = setInterval(scanTick, SCAN_INTERVAL_MS);
    return () => {
      if (scanLoopRef.current) {
        clearInterval(scanLoopRef.current);
        scanLoopRef.current = null;
      }
    };
  }, [phase, scanTick]);

  // ---- Auto-reset the result card after RESULT_HOLD_MS ----
  useEffect(() => {
    if (phase !== 'result') return;
    resultTimerRef.current = setTimeout(() => {
      resetToScanning();
    }, RESULT_HOLD_MS);
    return () => {
      if (resultTimerRef.current) {
        clearTimeout(resultTimerRef.current);
        resultTimerRef.current = null;
      }
    };
  }, [phase]);

  function resetToScanning() {
    setResult(null);
    setBumpWarning(null);
    setPhase('idle');
  }

  // ---- Torch toggle ----
  async function toggleTorch() {
    const stream = streamRef.current;
    if (!stream) return;
    const [track] = stream.getVideoTracks();
    if (!track) return;
    const next = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorch(next);
    } catch {
      // Some devices claim torch capability but reject the constraint; hide
      // the button so we do not offer a broken control twice.
      setTorchSupported(false);
    }
  }

  // ---- Render ----
  return (
    <main
      className="fixed inset-0 flex flex-col overflow-hidden"
      style={{ background: '#0a0a0a', color: '#f5f5f5' }}
    >
      {/* Camera layer: always mounted so the stream stays alive even while a
          result card covers it. Object-fit cover keeps the video square-filling
          the viewport on any iPad orientation. */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ background: '#000' }}
        playsInline
        muted
        autoPlay
      />

      {/* Dim overlay + framing reticle. Only shown while scanning so the
          result card is not muddied by the reticle behind it. */}
      {phase === 'idle' && (
        <>
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.35)' }} />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="rounded-3xl border-2"
              style={{
                width: 'min(70vmin, 520px)',
                height: 'min(70vmin, 520px)',
                borderColor: 'rgba(124,252,155,0.9)',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
              }}
            />
          </div>
        </>
      )}

      {/* Top bar: title + torch */}
      <header className="relative z-10 flex items-start justify-between px-6 pt-[max(1rem,env(safe-area-inset-top))]">
        <div>
          <div className="text-[11px] font-bold tracking-[0.2em]" style={{ color: '#7CFC9B' }}>
            IPAD · SCAN
          </div>
          <div
            className="text-[22px] font-extrabold leading-tight"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Scan Trial SDG Pass
          </div>
        </div>
        {torchSupported && phase !== 'camera_error' && (
          <button
            type="button"
            onClick={toggleTorch}
            className="px-4 py-2 rounded-xl text-[13px] font-bold"
            style={{
              background: torch ? '#ffb84d' : 'rgba(30,30,30,0.85)',
              color: torch ? '#0a0a0a' : '#f5f5f5',
            }}
          >
            {torch ? 'Torch on' : 'Torch'}
          </button>
        )}
      </header>

      {/* Center hint area — the reticle-eye copy while scanning, or the soft
          "not a pass" notice when a non-pass QR was detected. */}
      {phase === 'idle' && (
        <div className="relative z-10 flex-1 flex items-end justify-center pb-24 px-6 pointer-events-none">
          <div
            className="rounded-2xl px-5 py-3 text-center"
            style={{ background: 'rgba(0,0,0,0.55)', color: '#e5e5e5' }}
          >
            <div className="text-[15px] font-semibold">
              {notAPassMessage || 'Hold their pass QR inside the frame.'}
            </div>
          </div>
        </div>
      )}

      {/* Scanning spinner */}
      {phase === 'scanning' && (
        <div className="relative z-10 flex-1 flex items-center justify-center">
          <div
            className="rounded-2xl px-6 py-5 text-center"
            style={{ background: 'rgba(0,0,0,0.75)', color: '#f5f5f5' }}
          >
            <div className="text-[17px] font-bold">Checking pass…</div>
          </div>
        </div>
      )}

      {/* Result card: fills the screen so it is impossible to miss at arm's
          length. Color-coded green/red/amber; big first-name headline; big
          reason line; big "Next guest" button under the thumb. */}
      {phase === 'result' && result && (
        <div className="relative z-10 flex-1 flex flex-col justify-end">
          <ResultCard
            result={result}
            bumpWarning={bumpWarning}
            onNext={resetToScanning}
          />
        </div>
      )}

      {/* Camera error: fills the screen. Nothing else is useful without a
          camera, so we hide the header and show a single actionable message. */}
      {phase === 'camera_error' && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center px-8 text-center"
          style={{ background: '#0a0a0a' }}
        >
          <div className="text-[11px] font-bold tracking-[0.2em] mb-3" style={{ color: '#ff8a8a' }}>
            CAMERA UNAVAILABLE
          </div>
          <div
            className="text-[24px] font-extrabold mb-4 max-w-[520px]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {cameraErrorMessage || 'Camera could not start.'}
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-6 py-3 rounded-2xl text-[16px] font-bold"
            style={{ background: '#7CFC9B', color: '#0a0a0a' }}
          >
            Reload
          </button>
        </div>
      )}
    </main>
  );
}

function ResultCard({ result, bumpWarning, onNext }) {
  const { theme, headline, subhead } = resultTheme(result);
  const guestName = result.guest?.firstName || '';
  const eventTitle = result.event?.title || null;
  const staffAction = result.staffAction || null;
  const statusLabel = result.guest?.statusLabel || null;
  const expiresLabel = result.guest?.expiresLabel || null;

  return (
    <section
      className="w-full rounded-t-3xl px-6 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] border-t"
      style={{
        background: theme.background,
        borderColor: theme.border,
        color: theme.foreground,
      }}
    >
      <div className="text-[13px] font-bold tracking-[0.18em] mb-2 uppercase" style={{ color: theme.accent }}>
        {headline}
      </div>
      {guestName && (
        <div
          className="text-[40px] font-extrabold leading-tight mb-1"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          {guestName}
        </div>
      )}
      {subhead && (
        <div className="text-[18px] font-semibold mb-2" style={{ color: theme.foreground }}>
          {subhead}
        </div>
      )}
      {(statusLabel || expiresLabel) && (
        <div className="text-[14px] mb-2" style={{ color: theme.mutedForeground }}>
          {[statusLabel, expiresLabel].filter(Boolean).join(' · ')}
        </div>
      )}
      {eventTitle && (
        <div className="text-[14px] mb-2" style={{ color: theme.mutedForeground }}>
          Tonight: {eventTitle}
        </div>
      )}
      {staffAction && (
        <div
          className="rounded-2xl px-4 py-3 my-3 border"
          style={{
            background: 'rgba(0,0,0,0.25)',
            borderColor: theme.border,
            color: theme.foreground,
          }}
        >
          <div className="text-[11px] font-bold tracking-[0.16em] uppercase mb-1" style={{ color: theme.accent }}>
            Staff action
          </div>
          <div className="text-[16px] font-semibold">{staffAction}</div>
        </div>
      )}
      {bumpWarning && (
        <div
          className="rounded-xl px-4 py-2 mt-2 text-[13px] font-semibold"
          style={{ background: 'rgba(255,184,77,0.16)', color: '#ffb84d' }}
        >
          {bumpWarning}
        </div>
      )}
      <button
        type="button"
        onClick={onNext}
        className="w-full mt-5 rounded-2xl py-5 text-[20px] font-extrabold active:scale-[0.98] transition-transform"
        style={{
          background: theme.buttonBg,
          color: theme.buttonFg,
          fontFamily: "'Plus Jakarta Sans', sans-serif",
        }}
      >
        Next guest
      </button>
    </section>
  );
}

// Everything a result card renders is derived from the DOOR_RESULTS value the
// server returned. Kept in one place so a new denial reason only needs a row
// added here, not scattered branches through the JSX.
function resultTheme(result) {
  const code = result.result;

  if (code === 'allowed') {
    return {
      headline: 'Allowed',
      subhead: 'Wave them in.',
      theme: greenTheme(),
    };
  }

  if (code === 'denied_expired') {
    return {
      headline: 'Denied · Expired',
      subhead: 'Trial pass has expired.',
      theme: redTheme(),
    };
  }

  if (code === 'denied_ineligible_event') {
    return {
      headline: 'Denied · Wrong event',
      subhead: 'Trial passes only work on Friday, Saturday, or Sunday music events.',
      theme: amberTheme(),
    };
  }

  if (code === 'denied_duplicate') {
    return {
      headline: 'Denied · Already used tonight',
      subhead: 'This pass was already scanned in for tonight.',
      theme: amberTheme(),
    };
  }

  if (code === 'not_a_pass') {
    return {
      headline: 'Not a Trial SDG Pass',
      subhead: result.reason || 'This QR is not a valid pass.',
      theme: redTheme(),
    };
  }

  // Server errors, network fallback, or any DOOR_RESULTS value we do not
  // recognize yet all land here so the door still sees SOMETHING.
  return {
    headline: 'Scan failed',
    subhead: result.reason || 'Something went wrong.',
    theme: redTheme(),
  };
}

function greenTheme() {
  return {
    background: '#0d3d1c',
    border: 'rgba(124,252,155,0.35)',
    foreground: '#e8ffe8',
    mutedForeground: '#b8e6c1',
    accent: '#7CFC9B',
    buttonBg: '#7CFC9B',
    buttonFg: '#0a2410',
  };
}

function redTheme() {
  return {
    background: '#3d1010',
    border: 'rgba(255,138,138,0.35)',
    foreground: '#ffecec',
    mutedForeground: '#e6b8b8',
    accent: '#ff8a8a',
    buttonBg: '#ff8a8a',
    buttonFg: '#2a0a0a',
  };
}

function amberTheme() {
  return {
    background: '#3d2a0d',
    border: 'rgba(255,184,77,0.35)',
    foreground: '#fff2d9',
    mutedForeground: '#e6cfa3',
    accent: '#ffb84d',
    buttonBg: '#ffb84d',
    buttonFg: '#2a1c05',
  };
}

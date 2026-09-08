'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sniffScan } from '@/lib/scan/sniff';

// The unified Door Scanner UI.
//
// Camera up \u2192 detect QR \u2192 sniff KIND \u2192 POST preview \u2192 show face+name+context
// card \u2192 staff taps Verify or Reject \u2192 log the decision \u2192 back to scanning.
//
// State machine (one card on screen at a time):
//
//   booting        \u2014 asking for camera / spinning up BarcodeDetector
//   idle           \u2014 camera live, scanning at 5 fps, no card shown
//   scanning       \u2014 saw a QR, POSTing preview endpoint
//   preview        \u2014 got the person; staff decides Verify or Reject. Nothing
//                    written to the DB yet on trial passes or tickets (their
//                    preview endpoints are pure reads). Member scans have no
//                    activation state at all \u2014 same badge each visit \u2014 so
//                    preview is also a pure read there.
//   result         \u2014 staff decided; final card up for RESULT_HOLD_MS then reset
//   not_ours       \u2014 QR is not a Stardust QR (Wi-Fi, Instagram, etc.)
//   error          \u2014 the preview call failed
//   camera_error   \u2014 no camera / no BarcodeDetector / permission denied
//
// Auto-reset after a decision: RESULT_HOLD_MS gives staff time to see the
// green/red confirmation without having to tap Next Guest for every single
// scan. Dedup window blocks a stationary QR from re-triggering while the
// preview is on screen.

const SCAN_INTERVAL_MS = 200;
const RESULT_HOLD_MS = 4500;
const DUPLICATE_WINDOW_MS = 3000;

// Reject reason menus per kind. Kept per-kind because a trial-pass reject
// has different natural reasons than a ticket reject (no "wrong event" on a
// trial pass) than a member reject.
const REJECT_REASONS_BY_KIND = {
  trial_pass: [
    { code: 'photo_mismatch',   label: 'Photo mismatch' },
    { code: 'no_photo_on_file', label: 'No photo on file' },
    { code: 'id_mismatch',      label: 'ID mismatch' },
    { code: 'manual',           label: 'Manual reject' },
  ],
  ticket: [
    { code: 'photo_mismatch',   label: 'Photo mismatch' },
    { code: 'no_photo_on_file', label: 'No photo on file' },
    { code: 'id_mismatch',      label: 'ID mismatch' },
    { code: 'buyer_not_present', label: 'Buyer not present' },
    { code: 'manual',           label: 'Manual reject' },
  ],
  member_id: [
    { code: 'photo_mismatch',       label: 'Photo mismatch' },
    { code: 'no_photo_on_file',     label: 'No photo on file' },
    { code: 'id_mismatch',          label: 'ID mismatch' },
    { code: 'membership_inactive',  label: 'Membership inactive' },
    { code: 'manual',               label: 'Manual reject' },
  ],
};

export default function UnifiedScanClient() {
  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const streamRef = useRef(null);
  const scanLoopRef = useRef(null);
  const lastScanRef = useRef({ payload: null, at: 0 });
  const resetTimerRef = useRef(null);

  const [phase, setPhase] = useState('booting');
  const [preview, setPreview] = useState(null); // { kind, payload, data }
  const [result, setResult] = useState(null);   // { kind, ok, message, reason? }
  const [rejectPickerOpen, setRejectPickerOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [cameraErrorMessage, setCameraErrorMessage] = useState(null);
  const [notOursMessage, setNotOursMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  // --- reset back to idle scanning ---
  const resetToIdle = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setPreview(null);
    setResult(null);
    setRejectPickerOpen(false);
    setRejectNote('');
    setNotOursMessage(null);
    setErrorMessage(null);
    setDecisionBusy(false);
    lastScanRef.current = { payload: null, at: 0 };
    setPhase('idle');
  }, []);

  // --- preview flow ---
  const runPreview = useCallback(async (payload) => {
    const sniff = sniffScan(payload);

    if (sniff.kind === 'unknown') {
      setNotOursMessage('Not a Stardust QR');
      setPhase('not_ours');
      resetTimerRef.current = setTimeout(resetToIdle, 2500);
      return;
    }

    setPhase('scanning');
    try {
      let res;
      if (sniff.kind === 'trial_pass') {
        res = await fetch('/api/capacity/trial-pass/scan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: sniff.token, mode: 'preview' }),
        });
      } else if (sniff.kind === 'member_id') {
        res = await fetch('/api/scan/member-id', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: sniff.token, mode: 'preview' }),
        });
      } else if (sniff.kind === 'ticket') {
        // The ticket scanner endpoint needs an event_id at preview to bind
        // the scan to the current event. Without one we can still look the
        // ticket up but not check it in. For the unified scanner we show a
        // "load an event first" hint if no event is loaded.
        // For now: emit a not-yet-supported message; PR G+1 will add event
        // selector to /scan.
        setNotOursMessage('Ticket QR: use /t/scan for now');
        setPhase('not_ours');
        resetTimerRef.current = setTimeout(resetToIdle, 2500);
        return;
      } else if (sniff.kind === 'ambiguous_token') {
        // Bare 43-char base64url \u2014 same shape as both member and trial-pass
        // tokens. Try member first (more common in-venue).
        res = await fetch('/api/scan/member-id', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: sniff.token, mode: 'preview' }),
        });
        if (res.status === 404) {
          // Not a member \u2014 fall through to trial-pass.
          res = await fetch('/api/capacity/trial-pass/scan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: sniff.token, mode: 'preview' }),
          });
        }
      }

      if (!res) {
        setErrorMessage('Scanner internal error');
        setPhase('error');
        resetTimerRef.current = setTimeout(resetToIdle, 3000);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMessage(body?.error || `Preview failed (${res.status})`);
        setPhase('error');
        resetTimerRef.current = setTimeout(resetToIdle, 3000);
        return;
      }

      setPreview({ kind: normalizePreviewKind(sniff.kind, body), payload: sniff.token || sniff.code, data: body });
      setPhase('preview');
    } catch (err) {
      setErrorMessage(err?.message || 'Network error');
      setPhase('error');
      resetTimerRef.current = setTimeout(resetToIdle, 3000);
    }
  }, [resetToIdle]);

  // --- decision handlers ---
  const commitVerify = useCallback(async () => {
    if (!preview || decisionBusy) return;
    setDecisionBusy(true);
    const { kind, payload } = preview;

    try {
      let res;
      if (kind === 'trial_pass') {
        res = await fetch('/api/capacity/trial-pass/scan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: payload, mode: 'checkin' }),
        });
      } else if (kind === 'member_id') {
        res = await fetch('/api/scan/member-id', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: payload, mode: 'verify' }),
        });
      } else {
        setErrorMessage('Unknown scan kind on verify');
        setDecisionBusy(false);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMessage(body?.error || `Verify failed (${res.status})`);
        setPhase('error');
      } else {
        const firstName = body?.member?.firstName || body?.pass?.firstName || 'Guest';
        setResult({ kind, ok: true, message: `${firstName} verified` });
        setPhase('result');
      }
    } catch (err) {
      setErrorMessage(err?.message || 'Network error');
      setPhase('error');
    } finally {
      setDecisionBusy(false);
      resetTimerRef.current = setTimeout(resetToIdle, RESULT_HOLD_MS);
    }
  }, [preview, decisionBusy, resetToIdle]);

  const commitReject = useCallback(async (reasonCode) => {
    if (!preview || decisionBusy) return;
    setDecisionBusy(true);
    const { kind, payload } = preview;

    try {
      let res;
      if (kind === 'trial_pass') {
        res = await fetch('/api/capacity/trial-pass/scan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: payload, mode: 'reject', reject_reason: reasonCode, note: rejectNote || undefined }),
        });
      } else if (kind === 'member_id') {
        res = await fetch('/api/scan/member-id', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: payload, mode: 'reject', reject_reason: reasonCode, note: rejectNote || undefined }),
        });
      } else {
        setErrorMessage('Unknown scan kind on reject');
        setDecisionBusy(false);
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMessage(body?.error || `Reject failed (${res.status})`);
        setPhase('error');
      } else {
        setResult({ kind, ok: false, message: 'Rejected', reason: reasonCode });
        setPhase('result');
      }
    } catch (err) {
      setErrorMessage(err?.message || 'Network error');
      setPhase('error');
    } finally {
      setDecisionBusy(false);
      resetTimerRef.current = setTimeout(resetToIdle, RESULT_HOLD_MS);
    }
  }, [preview, decisionBusy, rejectNote, resetToIdle]);

  // --- scan loop ---
  const scanFrame = useCallback(async () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector) return;
    if (video.readyState < 2) return;
    if (phase !== 'idle') return;

    try {
      const codes = await detector.detect(video);
      if (!codes || codes.length === 0) return;
      const payload = (codes[0]?.rawValue || '').trim();
      if (!payload) return;

      const now = Date.now();
      if (lastScanRef.current.payload === payload && now - lastScanRef.current.at < DUPLICATE_WINDOW_MS) {
        return;
      }
      lastScanRef.current = { payload, at: now };
      runPreview(payload);
    } catch {
      // BarcodeDetector.detect can throw on decode noise; ignore.
    }
  }, [phase, runPreview]);

  // --- camera boot ---
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (typeof window === 'undefined' || !('BarcodeDetector' in window)) {
        setCameraErrorMessage('This browser cannot scan QR codes. Use Safari 17+ or a Chromium-based browser.');
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
          await video.play().catch(() => {});
        }
        setPhase('idle');
      } catch (err) {
        const name = err?.name || '';
        if (name === 'NotAllowedError') {
          setCameraErrorMessage('Camera permission denied. Grant camera access in Settings, then reload.');
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
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      const stream = streamRef.current;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  // --- scan loop wiring ---
  useEffect(() => {
    if (phase !== 'idle') return;
    scanLoopRef.current = setInterval(scanFrame, SCAN_INTERVAL_MS);
    return () => {
      if (scanLoopRef.current) {
        clearInterval(scanLoopRef.current);
        scanLoopRef.current = null;
      }
    };
  }, [phase, scanFrame]);

  // --- render ---
  return (
    <div style={styles.root}>
      <video ref={videoRef} style={styles.video} playsInline muted />

      <div style={styles.header}>
        <div style={styles.brand}>SDG DOOR SCANNER</div>
        <div style={styles.hint}>{hintForPhase(phase)}</div>
      </div>

      {phase === 'camera_error' && (
        <OverlayCard>
          <div style={styles.errorTitle}>Camera not available</div>
          <div style={styles.body}>{cameraErrorMessage}</div>
        </OverlayCard>
      )}

      {phase === 'not_ours' && (
        <OverlayCard>
          <div style={styles.warnTitle}>{notOursMessage || 'Not a Stardust QR'}</div>
          <div style={styles.body}>Scanning will resume automatically.</div>
        </OverlayCard>
      )}

      {phase === 'error' && (
        <OverlayCard>
          <div style={styles.errorTitle}>Error</div>
          <div style={styles.body}>{errorMessage}</div>
          <button style={styles.nextButton} onClick={resetToIdle}>Next scan</button>
        </OverlayCard>
      )}

      {phase === 'preview' && preview && (
        <OverlayCard wide>
          <PreviewCard preview={preview} />
          {!rejectPickerOpen ? (
            <div style={styles.actionRow}>
              <button style={styles.verifyBtn} onClick={commitVerify} disabled={decisionBusy}>
                {decisionBusy ? '...' : verifyLabelForKind(preview.kind)}
              </button>
              <button style={styles.rejectBtn} onClick={() => setRejectPickerOpen(true)} disabled={decisionBusy}>
                Reject
              </button>
            </div>
          ) : (
            <RejectPicker
              kind={preview.kind}
              note={rejectNote}
              onNote={setRejectNote}
              onCancel={() => { setRejectPickerOpen(false); setRejectNote(''); }}
              onReject={commitReject}
              busy={decisionBusy}
            />
          )}
        </OverlayCard>
      )}

      {phase === 'result' && result && (
        <OverlayCard>
          <div style={result.ok ? styles.verifiedTitle : styles.rejectedTitle}>
            {result.ok ? 'VERIFIED' : 'REJECTED'}
          </div>
          <div style={styles.body}>
            {result.message}
            {result.reason ? ` \u00b7 ${labelForReason(result.kind, result.reason)}` : ''}
          </div>
          <button style={styles.nextButton} onClick={resetToIdle}>Next scan</button>
        </OverlayCard>
      )}
    </div>
  );
}

function OverlayCard({ children, wide }) {
  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.card, ...(wide ? styles.cardWide : null) }}>{children}</div>
    </div>
  );
}

function PreviewCard({ preview }) {
  const { kind, data } = preview;
  const person = personFromPreview(kind, data);
  return (
    <div style={styles.previewInner}>
      <div style={styles.kindBadge}>{labelForKind(kind)}</div>
      <div style={styles.photoWrap}>
        {person.photoUrl ? (
          <img src={person.photoUrl} alt="" style={styles.photo} />
        ) : (
          <div style={styles.noPhoto}>NO PHOTO</div>
        )}
      </div>
      <div style={styles.name}>{person.fullName || person.firstName || 'Guest'}</div>
      {person.subline && <div style={styles.subline}>{person.subline}</div>}
      {kind === 'member_id' && person.isActive === false && (
        <div style={styles.inactivePill}>MEMBERSHIP INACTIVE</div>
      )}
    </div>
  );
}

function RejectPicker({ kind, note, onNote, onCancel, onReject, busy }) {
  const reasons = REJECT_REASONS_BY_KIND[kind] || REJECT_REASONS_BY_KIND.member_id;
  return (
    <div style={styles.rejectPicker}>
      <div style={styles.rejectHeader}>Reject reason</div>
      <div style={styles.reasonGrid}>
        {reasons.map((r) => (
          <button
            key={r.code}
            style={styles.reasonBtn}
            onClick={() => onReject(r.code)}
            disabled={busy}
          >
            {r.label}
          </button>
        ))}
      </div>
      <input
        type="text"
        placeholder="Optional note"
        value={note}
        onChange={(e) => onNote(e.target.value)}
        style={styles.noteInput}
        maxLength={280}
      />
      <button style={styles.cancelBtn} onClick={onCancel} disabled={busy}>Cancel</button>
    </div>
  );
}

// --- helpers ---
function normalizePreviewKind(sniffKind, body) {
  if (sniffKind === 'ambiguous_token') {
    // The preview body tells us which one it turned out to be. Member
    // endpoint returns `member`, trial-pass returns `pass` or trialPass.
    if (body?.member) return 'member_id';
    return 'trial_pass';
  }
  return sniffKind;
}

function personFromPreview(kind, body) {
  if (kind === 'member_id' && body?.member) {
    const m = body.member;
    const sublineBits = [];
    if (m.tierLabel) sublineBits.push(m.tierLabel);
    sublineBits.push(m.isActive ? 'Active' : 'Inactive');
    return {
      fullName: m.fullName,
      firstName: m.firstName,
      photoUrl: m.photoSignedUrl,
      isActive: m.isActive,
      subline: sublineBits.join(' \u00b7 '),
    };
  }
  if (kind === 'trial_pass') {
    const p = body?.pass || body?.trialPass || body;
    return {
      fullName: p?.fullName,
      firstName: p?.firstName,
      photoUrl: p?.photoSignedUrl || null,
      subline: 'Trial SDG Pass',
    };
  }
  return { firstName: 'Guest', photoUrl: null };
}

function labelForKind(kind) {
  if (kind === 'member_id') return 'MEMBER ID';
  if (kind === 'trial_pass') return 'TRIAL PASS';
  if (kind === 'ticket') return 'TICKET';
  return 'UNKNOWN';
}

function verifyLabelForKind(kind) {
  if (kind === 'trial_pass') return 'Check In';
  return 'Verify';
}

function labelForReason(kind, code) {
  const list = REJECT_REASONS_BY_KIND[kind] || REJECT_REASONS_BY_KIND.member_id;
  return list.find((r) => r.code === code)?.label || code;
}

function hintForPhase(phase) {
  switch (phase) {
    case 'booting': return 'Starting camera...';
    case 'idle': return 'Hold a QR up to the camera';
    case 'scanning': return 'Reading...';
    case 'preview': return 'Verify or Reject';
    case 'result': return 'Ready for next scan';
    case 'not_ours': return '';
    case 'error': return '';
    case 'camera_error': return '';
    default: return '';
  }
}

// --- styles (dark SDG palette) ---
const styles = {
  root: {
    position: 'fixed', inset: 0, background: '#0a0a0a', color: '#f5f5f5',
    fontFamily: "'Plus Jakarta Sans', sans-serif", overflow: 'hidden',
  },
  video: {
    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
  },
  header: {
    position: 'absolute', top: 0, left: 0, right: 0, padding: '16px 24px',
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.75), rgba(0,0,0,0))',
    display: 'flex', flexDirection: 'column', gap: 4, zIndex: 2,
  },
  brand: { fontSize: 14, letterSpacing: 2, color: '#d9c48c', fontWeight: 600 },
  hint: { fontSize: 16, color: '#8a8a8a' },
  overlay: {
    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3, padding: 24,
  },
  card: {
    background: '#111', borderRadius: 20, padding: 32, maxWidth: 480, width: '100%',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  },
  cardWide: { maxWidth: 560 },
  previewInner: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  kindBadge: {
    fontSize: 12, letterSpacing: 3, color: '#d9c48c', fontWeight: 700,
    padding: '4px 10px', border: '1px solid #d9c48c', borderRadius: 4,
  },
  photoWrap: {
    width: 200, height: 200, borderRadius: 12, overflow: 'hidden', background: '#0f0f0f',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  photo: { width: '100%', height: '100%', objectFit: 'cover' },
  noPhoto: { color: '#8a8a8a', fontSize: 14, letterSpacing: 2 },
  name: { fontSize: 28, fontWeight: 700, textAlign: 'center' },
  subline: { fontSize: 16, color: '#8a8a8a' },
  inactivePill: {
    marginTop: 8, padding: '6px 12px', borderRadius: 999,
    background: '#3a1414', color: '#ff8686', fontSize: 12, letterSpacing: 2, fontWeight: 700,
  },
  actionRow: { display: 'flex', gap: 12, marginTop: 20 },
  verifyBtn: {
    flex: 2, padding: '20px 24px', borderRadius: 12, border: 'none',
    background: '#155a2a', color: '#7CFC9B', fontSize: 20, fontWeight: 700, cursor: 'pointer',
  },
  rejectBtn: {
    flex: 1, padding: '20px 16px', borderRadius: 12, border: '1px solid #3a1414',
    background: 'transparent', color: '#ff8686', fontSize: 18, fontWeight: 600, cursor: 'pointer',
  },
  rejectPicker: { marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 },
  rejectHeader: { fontSize: 14, color: '#8a8a8a', letterSpacing: 2 },
  reasonGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  reasonBtn: {
    padding: '14px 12px', borderRadius: 10, border: '1px solid #333',
    background: '#0f0f0f', color: '#f5f5f5', fontSize: 15, cursor: 'pointer',
  },
  noteInput: {
    padding: '12px 14px', borderRadius: 10, border: '1px solid #333',
    background: '#0a0a0a', color: '#f5f5f5', fontSize: 14, fontFamily: 'inherit',
  },
  cancelBtn: {
    padding: '12px', borderRadius: 10, border: '1px solid #333',
    background: 'transparent', color: '#8a8a8a', fontSize: 14, cursor: 'pointer',
  },
  verifiedTitle: { fontSize: 40, fontWeight: 800, color: '#7CFC9B', textAlign: 'center', letterSpacing: 3 },
  rejectedTitle: { fontSize: 40, fontWeight: 800, color: '#ff8686', textAlign: 'center', letterSpacing: 3 },
  errorTitle: { fontSize: 24, fontWeight: 700, color: '#ff8686', textAlign: 'center' },
  warnTitle: { fontSize: 24, fontWeight: 700, color: '#d9c48c', textAlign: 'center' },
  body: { fontSize: 16, color: '#8a8a8a', textAlign: 'center', marginTop: 12 },
  nextButton: {
    marginTop: 20, padding: '16px 24px', borderRadius: 12, border: 'none',
    background: '#d9c48c', color: '#0a0a0a', fontSize: 16, fontWeight: 700, cursor: 'pointer', width: '100%',
  },
};

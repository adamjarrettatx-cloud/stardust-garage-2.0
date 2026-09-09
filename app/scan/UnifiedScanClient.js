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

  // Event context for ticket scans. Shared with /t/scan via localStorage
  // so switching between the two scanners on the same device keeps the
  // same event loaded. Tickets need this at preview; trial passes and
  // member IDs do NOT.
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [pendingTicketCode, setPendingTicketCode] = useState(null);

  // Door session state — the source of truth for "which event tonight".
  //   activeSession: currently-open door_sessions row (or null)
  //   sessionLoading: initial fetch pending, don't render Start button yet
  //   sessionBusy:    a start/end call is in flight
  //   confirmEnd:     End Event confirm modal open
  //   sessionError:   most recent start/end failure message
  const [activeSession, setActiveSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [startPickerOpen, setStartPickerOpen] = useState(false);

  // Load events + fetch the active door session. Also restore last-used
  // event from localStorage as a fallback for scanners run before staff
  // starts a shift (rare — used mostly for team testing/off-hours).
  useEffect(() => {
    fetch('/api/tickets/scanner-events')
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setEvents(Array.isArray(d?.events) ? d.events : []))
      .catch(() => setEvents([]));
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('sdg_scanner_event');
      if (stored) setEventId(stored);
    }
    fetch('/api/door-session/active')
      .then((r) => (r.ok ? r.json() : { session: null }))
      .then((d) => {
        if (d?.session) {
          setActiveSession(d.session);
          setEventId(d.session.event_id);
        }
      })
      .catch(() => {})
      .finally(() => setSessionLoading(false));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (eventId) window.localStorage.setItem('sdg_scanner_event', eventId);
    else window.localStorage.removeItem('sdg_scanner_event');
  }, [eventId]);

  const activeEvent = events.find((e) => e.id === eventId)
    || (activeSession?.event ? { id: activeSession.event.id, title: activeSession.event.title, event_date: activeSession.event.event_date } : null);

  const sessionId = activeSession?.id || null;

  // Start an event (open a door session). Called from the start picker.
  const startEvent = useCallback(async (evId) => {
    setSessionBusy(true);
    setSessionError('');
    try {
      const res = await fetch('/api/door-session/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event_id: evId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSessionError(body?.error || `Could not start event (${res.status})`);
        // If the server says one is already open, refresh our view of it.
        if (body?.active_session) setActiveSession({ ...body.active_session, event: null });
        return;
      }
      const session = body.session;
      const event = body.event;
      setActiveSession(session ? { ...session, event } : null);
      setEventId(event?.id || evId);
      setStartPickerOpen(false);
    } catch (err) {
      setSessionError(err?.message || 'Network error starting event');
    } finally {
      setSessionBusy(false);
    }
  }, []);

  // End the currently-open event (close the door session).
  const endEvent = useCallback(async () => {
    setSessionBusy(true);
    setSessionError('');
    try {
      const res = await fetch('/api/door-session/end', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSessionError(body?.error || `Could not end event (${res.status})`);
        return;
      }
      setActiveSession(null);
      setConfirmEnd(false);
      // Deliberately keep eventId around — /t/scan and manual ticket flows
      // may still want the last event as context. Session-gated scans
      // require an open session anyway.
    } catch (err) {
      setSessionError(err?.message || 'Network error ending event');
    } finally {
      setSessionBusy(false);
    }
  }, []);

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
    setPendingTicketCode(null);
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
          body: JSON.stringify({ token: sniff.token, mode: 'preview', eventId: eventId || undefined, door_session_id: sessionId }),
        });
      } else if (sniff.kind === 'member_id') {
        res = await fetch('/api/scan/member-id', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: sniff.token, mode: 'preview', event_id: eventId || undefined, door_session_id: sessionId }),
        });
      } else if (sniff.kind === 'ticket') {
        if (!eventId) {
          // Ticket previews need an event_id to bind the scan to. Prompt
          // staff to pick an event; keep the code around so tapping an
          // event immediately runs the preview.
          setPendingTicketCode(sniff.code);
          setEventPickerOpen(true);
          setPhase('idle');
          return;
        }
        res = await fetch('/api/tickets/scan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: sniff.code, event_id: eventId, mode: 'preview', door_session_id: sessionId }),
        });
      } else if (sniff.kind === 'ambiguous_token') {
        // Bare 43-char base64url \u2014 same shape as both member and trial-pass
        // tokens. Try member first (more common in-venue).
        res = await fetch('/api/scan/member-id', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: sniff.token, mode: 'preview', event_id: eventId || undefined, door_session_id: sessionId }),
        });
        if (res.status === 404) {
          // Not a member \u2014 fall through to trial-pass.
          res = await fetch('/api/capacity/trial-pass/scan', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ token: sniff.token, mode: 'preview', eventId: eventId || undefined, door_session_id: sessionId }),
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
      setPendingTicketCode(null);
    } catch (err) {
      setErrorMessage(err?.message || 'Network error');
      setPhase('error');
      resetTimerRef.current = setTimeout(resetToIdle, 3000);
    }
  }, [resetToIdle, eventId]);

  // Fire a ticket preview with an event id passed explicitly \u2014 used when
  // staff picks an event after a ticket QR was scanned. Bypasses the useState
  // read of `eventId` in the closure of runPreview, which hasn't re-rendered
  // yet at the moment of the pick.
  const runPreviewWithExplicitEvent = useCallback(async (code, evId) => {
    setPhase('scanning');
    try {
      const res = await fetch('/api/tickets/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, event_id: evId, mode: 'preview', door_session_id: sessionId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMessage(body?.error || `Preview failed (${res.status})`);
        setPhase('error');
        resetTimerRef.current = setTimeout(resetToIdle, 3000);
        return;
      }
      setPreview({ kind: 'ticket', payload: code, data: body });
      setPhase('preview');
    } catch (err) {
      setErrorMessage(err?.message || 'Network error');
      setPhase('error');
      resetTimerRef.current = setTimeout(resetToIdle, 3000);
    }
  }, [resetToIdle, sessionId]);

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
          body: JSON.stringify({ token: payload, mode: 'checkin', eventId: eventId || undefined, door_session_id: sessionId }),
        });
      } else if (kind === 'member_id') {
        res = await fetch('/api/scan/member-id', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: payload, mode: 'verify', event_id: eventId || undefined, door_session_id: sessionId }),
        });
      } else if (kind === 'ticket') {
        if (!eventId) {
          setErrorMessage('No event loaded');
          setDecisionBusy(false);
          return;
        }
        res = await fetch('/api/tickets/scan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: payload, event_id: eventId, mode: 'checkin', door_session_id: sessionId }),
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
        const firstName = body?.member?.firstName || body?.pass?.firstName || body?.buyer?.firstName || 'Guest';
        // If the member-id verify also redeemed a linked ticket, roll
        // that acknowledgement into the same result card so staff sees
        // both actions completed in one screen.
        let message = `${firstName} verified`;
        if (kind === 'trial_pass') message = `${firstName} checked in`;
        if ((kind === 'member_id' || kind === 'trial_pass') && body?.ticket) {
          const base = kind === 'trial_pass' ? `${firstName} checked in` : `${firstName} verified`;
          if (body.ticket.result === 'valid') {
            const label = body.ticket.product_label ? ` (${body.ticket.product_label})` : '';
            message = `${base} + ticket${label} checked in`;
          } else if (body.ticket.result === 'already_used') {
            message = `${base} \u00b7 ticket was already used`;
          }
        }
        setResult({ kind, ok: true, message });
        setPhase('result');
      }
    } catch (err) {
      setErrorMessage(err?.message || 'Network error');
      setPhase('error');
    } finally {
      setDecisionBusy(false);
      resetTimerRef.current = setTimeout(resetToIdle, RESULT_HOLD_MS);
    }
  }, [preview, decisionBusy, resetToIdle, eventId, sessionId]);

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
          body: JSON.stringify({ token: payload, mode: 'reject', reject_reason: reasonCode, note: rejectNote || undefined, eventId: eventId || undefined, door_session_id: sessionId }),
        });
      } else if (kind === 'member_id') {
        res = await fetch('/api/scan/member-id', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: payload, mode: 'reject', reject_reason: reasonCode, note: rejectNote || undefined, event_id: eventId || undefined, door_session_id: sessionId }),
        });
      } else if (kind === 'ticket') {
        if (!eventId) {
          setErrorMessage('No event loaded');
          setDecisionBusy(false);
          return;
        }
        res = await fetch('/api/tickets/scan', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: payload, event_id: eventId, mode: 'reject', reject_reason: reasonCode, note: rejectNote || undefined, door_session_id: sessionId }),
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
  }, [preview, decisionBusy, rejectNote, resetToIdle, eventId, sessionId]);

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
        <div style={styles.headerRow}>
          <div style={styles.brand}>SDG DOOR SCANNER</div>
          <SessionControl
            sessionLoading={sessionLoading}
            activeSession={activeSession}
            activeEvent={activeEvent}
            sessionBusy={sessionBusy}
            onStart={() => { setSessionError(''); setStartPickerOpen(true); }}
            onEnd={() => { setSessionError(''); setConfirmEnd(true); }}
            onPickEvent={() => setEventPickerOpen(true)}
          />
        </div>
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
          <PreviewCard preview={preview} activeEvent={activeEvent} />
          {!rejectPickerOpen ? (
            <div style={styles.actionRow}>
              <button style={styles.verifyBtn} onClick={commitVerify} disabled={decisionBusy}>
                {decisionBusy ? '...' : verifyLabelForPreview(preview)}
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

      {eventPickerOpen && (
        <EventPickerOverlay
          events={events}
          activeEventId={eventId}
          onPick={(id) => {
            setEventId(id);
            setEventPickerOpen(false);
            // If a ticket QR was waiting for an event to be picked, run its
            // preview now.
            if (pendingTicketCode && id) {
              const code = pendingTicketCode;
              setPendingTicketCode(null);
              // Reset the dedupe so an immediate re-scan of the same code works.
              lastScanRef.current = { payload: null, at: 0 };
              // Kick the ticket preview with the freshly-picked event id.
              runPreviewWithExplicitEvent(code, id);
            }
          }}
          onClear={() => { setEventId(''); setEventPickerOpen(false); }}
          onCancel={() => setEventPickerOpen(false)}
          pendingTicketCode={pendingTicketCode}
        />
      )}

      {startPickerOpen && (
        <StartEventOverlay
          events={events}
          busy={sessionBusy}
          errorMessage={sessionError}
          onPick={startEvent}
          onCancel={() => setStartPickerOpen(false)}
        />
      )}

      {confirmEnd && activeSession && (
        <ConfirmEndOverlay
          event={activeEvent}
          busy={sessionBusy}
          errorMessage={sessionError}
          onConfirm={endEvent}
          onCancel={() => { setConfirmEnd(false); setSessionError(''); }}
        />
      )}

      {sessionError && !startPickerOpen && !confirmEnd && (
        <div style={styles.sessionToast}>{sessionError}</div>
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

function PreviewCard({ preview, activeEvent }) {
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
      {kind === 'ticket' && activeEvent && (
        <div style={styles.ticketEventLine}>{activeEvent.title}</div>
      )}
      {kind === 'member_id' && person.isActive === false && (
        <div style={styles.inactivePill}>MEMBERSHIP INACTIVE</div>
      )}
      {(kind === 'member_id' || kind === 'trial_pass') && preview?.data?.linked_ticket && (
        <div style={styles.linkedTicketPill}>
          + TICKET{preview.data.linked_ticket.product_label ? `: ${preview.data.linked_ticket.product_label}` : ''} · WILL CHECK IN
        </div>
      )}
      {kind === 'ticket' && person.isActive === false && (
        <div style={styles.inactivePill}>NOT VALID</div>
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
  if (kind === 'ticket' && body?.buyer) {
    const b = body.buyer;
    const sublineBits = ['Ticket'];
    // Surface non-valid preview results (refunded, wrong_event, used, void)
    // in the subline so staff sees it before deciding \u2014 the underlying
    // /api/tickets/scan endpoint returns decision.result at preview.
    if (body.result && body.result !== 'valid') {
      sublineBits.push(String(body.result).toUpperCase().replace(/_/g, ' '));
    }
    return {
      fullName: b.displayName,
      firstName: b.firstName,
      photoUrl: b.photoSignedUrl || null,
      subline: sublineBits.join(' \u00b7 '),
      isActive: !body.result || body.result === 'valid',
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

// Same as verifyLabelForKind but aware of a preview carrying a linked
// ticket \u2014 in that case one tap does both, so the button label should
// communicate the combined action.
function verifyLabelForPreview(preview) {
  if (!preview) return 'Verify';
  if (preview.kind === 'member_id' && preview.data?.linked_ticket) return 'Verify + Check In';
  if (preview.kind === 'trial_pass' && preview.data?.linked_ticket) return 'Check In + Ticket';
  return verifyLabelForKind(preview.kind);
}

function labelForReason(kind, code) {
  const list = REJECT_REASONS_BY_KIND[kind] || REJECT_REASONS_BY_KIND.member_id;
  return list.find((r) => r.code === code)?.label || code;
}

function formatEventChip(evt) {
  if (!evt) return 'Pick event';
  const title = (evt.title || 'Event').slice(0, 22);
  return `\u25CF ${title}`;
}

function EventPickerOverlay({ events, activeEventId, onPick, onClear, onCancel, pendingTicketCode }) {
  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.card, ...styles.cardWide }}>
        <div style={styles.pickerHeader}>Pick event for ticket scans</div>
        {pendingTicketCode && (
          <div style={styles.pickerHint}>
            A ticket QR was just scanned. Pick the event it belongs to.
          </div>
        )}
        {events.length === 0 && (
          <div style={styles.pickerHint}>No upcoming internal-ticketing events.</div>
        )}
        <div style={styles.eventList}>
          {events.map((evt) => (
            <button
              key={evt.id}
              style={{
                ...styles.eventOption,
                ...(evt.id === activeEventId ? styles.eventOptionActive : null),
              }}
              onClick={() => onPick(evt.id)}
            >
              <div style={styles.eventOptionTitle}>{evt.title}</div>
              <div style={styles.eventOptionMeta}>{evt.event_date}{evt.start_time ? ` \u00b7 ${evt.start_time}` : ''}</div>
            </button>
          ))}
        </div>
        <div style={styles.pickerActions}>
          {activeEventId && (
            <button style={styles.pickerClearBtn} onClick={onClear}>Clear</button>
          )}
          <button style={styles.pickerCancelBtn} onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function SessionControl({ sessionLoading, activeSession, activeEvent, sessionBusy, onStart, onEnd, onPickEvent }) {
  if (sessionLoading) {
    return <div style={styles.sessionChipMuted}>…</div>;
  }
  if (activeSession) {
    const title = activeEvent?.title || 'Event live';
    const openedAt = activeSession.opened_at
      ? new Date(activeSession.opened_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '';
    return (
      <div style={styles.sessionActive}>
        <div style={styles.sessionActiveLive}>
          <span style={styles.sessionDot} />
          <span style={styles.sessionActiveTitle}>{title}</span>
          {openedAt && <span style={styles.sessionActiveMeta}> · opened {openedAt}</span>}
        </div>
        <button style={styles.sessionEndBtn} onClick={onEnd} disabled={sessionBusy}>
          End event
        </button>
      </div>
    );
  }
  return (
    <div style={styles.sessionInactive}>
      <button style={styles.sessionStartBtn} onClick={onStart} disabled={sessionBusy}>
        START EVENT →
      </button>
      {activeEvent && (
        <button style={styles.sessionPickBtn} onClick={onPickEvent} title="Change fallback event (no shift)">
          {activeEvent.title}
        </button>
      )}
    </div>
  );
}

function StartEventOverlay({ events, busy, errorMessage, onPick, onCancel }) {
  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.card, ...styles.cardWide }}>
        <div style={styles.pickerHeader}>Start event for tonight</div>
        <div style={styles.pickerHint}>
          Opens a door session. Every scan from here on is bound to this event
          until you tap End event.
        </div>
        {events.length === 0 && (
          <div style={styles.pickerHint}>No upcoming internal-ticketing events.</div>
        )}
        <div style={styles.eventList}>
          {events.map((evt) => (
            <button
              key={evt.id}
              style={styles.eventOption}
              onClick={() => onPick(evt.id)}
              disabled={busy}
            >
              <div style={styles.eventOptionTitle}>{evt.title}</div>
              <div style={styles.eventOptionMeta}>{evt.event_date}{evt.start_time ? ` \u00b7 ${evt.start_time}` : ''}</div>
            </button>
          ))}
        </div>
        {errorMessage && <div style={styles.pickerError}>{errorMessage}</div>}
        <div style={styles.pickerActions}>
          <button style={styles.pickerCancelBtn} onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmEndOverlay({ event, busy, errorMessage, onConfirm, onCancel }) {
  const title = event?.title || 'this event';
  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.pickerHeader}>End event?</div>
        <div style={styles.pickerHint}>
          Close the door session for <strong>{title}</strong>? Scans made after
          this will not be bound to any shift until you start a new event.
        </div>
        {errorMessage && <div style={styles.pickerError}>{errorMessage}</div>}
        <div style={styles.pickerActions}>
          <button style={styles.pickerCancelBtn} onClick={onCancel} disabled={busy}>Cancel</button>
          <button style={styles.rejectBtn} onClick={onConfirm} disabled={busy}>
            {busy ? 'Ending…' : 'End event'}
          </button>
        </div>
      </div>
    </div>
  );
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
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  brand: { fontSize: 14, letterSpacing: 2, color: '#d9c48c', fontWeight: 600 },
  eventChip: {
    padding: '6px 12px', borderRadius: 999, border: '1px solid #333',
    background: 'rgba(0,0,0,0.5)', color: '#f5f5f5', fontSize: 12, fontFamily: 'inherit',
    cursor: 'pointer', letterSpacing: 1, fontWeight: 600,
  },
  ticketEventLine: { fontSize: 13, color: '#d9c48c', textAlign: 'center', letterSpacing: 1, marginTop: 4 },
  pickerHeader: { fontSize: 18, fontWeight: 700, color: '#f5f5f5', marginBottom: 12 },
  pickerHint: { fontSize: 13, color: '#8a8a8a', marginBottom: 12 },
  eventList: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 360, overflowY: 'auto' },
  eventOption: {
    padding: '14px 16px', borderRadius: 10, border: '1px solid #333',
    background: '#0f0f0f', color: '#f5f5f5', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
  },
  eventOptionActive: { border: '1px solid #d9c48c', background: '#111' },
  eventOptionTitle: { fontSize: 15, fontWeight: 600 },
  eventOptionMeta: { fontSize: 12, color: '#8a8a8a', marginTop: 4 },
  pickerActions: { display: 'flex', gap: 12, marginTop: 16, justifyContent: 'flex-end' },
  pickerClearBtn: {
    padding: '10px 16px', borderRadius: 10, border: '1px solid #3a1414',
    background: 'transparent', color: '#ff8686', fontSize: 14, cursor: 'pointer',
  },
  pickerCancelBtn: {
    padding: '10px 16px', borderRadius: 10, border: '1px solid #333',
    background: 'transparent', color: '#8a8a8a', fontSize: 14, cursor: 'pointer',
  },
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
  linkedTicketPill: {
    marginTop: 8, padding: '6px 12px', borderRadius: 999,
    background: '#111', color: '#d9c48c', fontSize: 12, letterSpacing: 2, fontWeight: 700,
    border: '1px solid #d9c48c',
  },
  actionRow: { display: 'flex', gap: 12, marginTop: 20 },
  verifyBtn: {
    flex: 2, padding: '20px 24px', borderRadius: 12, border: 'none',
    background: '#8a5109', color: '#d9c48c', fontSize: 20, fontWeight: 700, cursor: 'pointer',
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
  verifiedTitle: { fontSize: 40, fontWeight: 800, color: '#d9c48c', textAlign: 'center', letterSpacing: 3 },
  rejectedTitle: { fontSize: 40, fontWeight: 800, color: '#ff8686', textAlign: 'center', letterSpacing: 3 },
  errorTitle: { fontSize: 24, fontWeight: 700, color: '#ff8686', textAlign: 'center' },
  warnTitle: { fontSize: 24, fontWeight: 700, color: '#d9c48c', textAlign: 'center' },
  body: { fontSize: 16, color: '#8a8a8a', textAlign: 'center', marginTop: 12 },
  nextButton: {
    marginTop: 20, padding: '16px 24px', borderRadius: 12, border: 'none',
    background: '#d9c48c', color: '#0a0a0a', fontSize: 16, fontWeight: 700, cursor: 'pointer', width: '100%',
  },
  sessionChipMuted: {
    padding: '8px 14px', borderRadius: 999, background: '#1a1a1a', color: '#8a8a8a',
    fontSize: 13, fontWeight: 600, letterSpacing: 1,
  },
  sessionActive: {
    display: 'flex', alignItems: 'center', gap: 10,
  },
  sessionActiveLive: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 14px', borderRadius: 999, background: '#111', border: '1px solid #8a5109',
  },
  sessionActiveTitle: { color: '#d9c48c', fontSize: 13, fontWeight: 700, letterSpacing: 0.5 },
  sessionActiveMeta:  { color: '#888', fontSize: 12 },
  sessionDot: {
    width: 8, height: 8, borderRadius: '50%', background: '#d9c48c',
    boxShadow: '0 0 8px #d9c48c', animation: 'pulse 1.4s ease-in-out infinite',
  },
  sessionEndBtn: {
    padding: '8px 12px', borderRadius: 999, border: '1px solid #333',
    background: 'transparent', color: '#8a8a8a', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  sessionInactive: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
  sessionStartBtn: {
    padding: '10px 18px', borderRadius: 999, border: 'none',
    background: '#d9c48c', color: '#0a0a0a', fontSize: 13, fontWeight: 800, letterSpacing: 1, cursor: 'pointer',
  },
  sessionPickBtn: {
    padding: '8px 12px', borderRadius: 999, border: '1px solid #333',
    background: 'transparent', color: '#8a8a8a', fontSize: 11, cursor: 'pointer',
  },
  pickerError: {
    marginTop: 12, padding: '10px 12px', borderRadius: 8,
    background: '#3a1414', border: '1px solid #5a2020', color: '#ff8686',
    fontSize: 13, textAlign: 'center',
  },
  sessionToast: {
    position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
    padding: '10px 16px', borderRadius: 999,
    background: '#3a1414', border: '1px solid #5a2020', color: '#ff8686',
    fontSize: 13, zIndex: 20,
  },
};

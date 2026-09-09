'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDoorScanner } from './useDoorScanner';
import { sniffScan } from '@/lib/scan/sniff';
import { planScanAttempts, shouldFallThroughAmbiguous } from '@/lib/scan/route-scan';

// UnifiedDoorScanner — the embedded scanner panel used at /capacity/front-desk.
//
// Reads a QR through the shared useDoorScanner hook, sniffs the payload, and
// asks planScanAttempts() what to POST first. Handles the ambiguous 32-hex
// case (member ID token and trial-pass token collide by shape) by trying the
// member endpoint first and falling through to trial-pass on 404.
//
// Everything is preview→decide: neither the trial-pass row nor the member_id
// scan log is written until staff sees the photo card and hits Check In (or
// Reject). That preserves the safety property the standalone /capacity/scan
// page shipped with — a friend scanning a forwarded QR cannot activate a
// pass or leak an audit row on someone else's badge.
//
// Capacity is bumped client-side after a verified/allowed decision by the
// caller: onAdmitted() fires the /api/capacity/operation POST from
// FrontDeskClient so the audit row's note carries the guest-list vs scan
// distinction. That mirrors how the guestlist path already works and keeps
// the scan endpoint pure audit.
//
// Props:
//   onActivity({kind, name, detail, id, result, at}) — fired on every
//     terminal transition (admitted or rejected) so the parent can push it
//     into the "last 5" panel.
//   onAdmitted({source})                              — fired once when the
//     Check In / Verify button flips state successfully. Parent bumps
//     capacity here and returns an optional warning string.
//   getBumpWarning({source}) => Promise<string | null> — called by the
//     scanner right after a success so the warning ("no active session",
//     "at capacity") can be rendered on the result card without the
//     scanner having to know about capacity_events itself.

const REJECT_REASONS_TRIAL_PASS = [
  { code: 'photo_mismatch',    label: 'Photo mismatch' },
  { code: 'no_photo_on_file',  label: 'No photo on file' },
  { code: 'id_mismatch',       label: 'ID mismatch' },
  { code: 'manual',            label: 'Manual reject' },
];

const REJECT_REASONS_MEMBER_ID = [
  { code: 'photo_mismatch',       label: 'Photo mismatch' },
  { code: 'no_photo_on_file',     label: 'No photo on file' },
  { code: 'id_mismatch',          label: 'ID mismatch' },
  { code: 'membership_inactive',  label: 'Membership inactive' },
  { code: 'manual',               label: 'Manual reject' },
];

const RESULT_HOLD_MS = 5000;

// Mutates `body` in place to add the active event + door session identifiers,
// using the field-name convention each endpoint expects. See lib/scan/route-
// scan.js for the same mapping used on the preview attempts. Kept as a helper
// so a future endpoint rename only touches one place.
function attachEventContext(body, source, eventId, doorSessionId) {
  if (!body) return body;
  if (eventId) {
    if (source === 'trial_pass') body.eventId = eventId;
    else body.event_id = eventId; // member_id + ticket
  }
  if (doorSessionId) body.door_session_id = doorSessionId;
  return body;
}

// Props:
//   activeEvent      — { id, title, event_date } | null. Threaded into every
//                      scan POST so member/trial/ticket scans stamp the right
//                      event_id on their audit row.
//   doorSessionId    — uuid of the currently-open door_sessions row | null.
//                      Same reason.
export default function UnifiedDoorScanner({
  activeEvent,
  doorSessionId,
  onActivity,
  onAdmitted,
  getBumpWarning,
}) {
  const eventId = activeEvent?.id || null;
  const [phase, setPhase] = useState('scanning'); // scanning | busy | preview | result
  const [busyLabel, setBusyLabel] = useState('Checking…');
  const [preview, setPreview] = useState(null);   // normalized VM (see buildPreviewVM)
  const [result, setResult] = useState(null);     // { theme, headline, subhead, name, bumpWarning }
  const [rejectPicker, setRejectPicker] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [softNotice, setSoftNotice] = useState(null); // brief "Not a valid QR" hint

  const softNoticeTimerRef = useRef(null);
  const resultHoldTimerRef = useRef(null);

  const scannerActive = phase === 'scanning';

  // showSoftNotice / showResult are stable-ish (declared below) but React does
  // not know that, so we pin them into the closure via refs to keep
  // onRawScan itself stable. This matters: onRawScan is passed into
  // useDoorScanner which starts / stops the 5fps scan loop; if it churned we
  // would tear the interval down on every render.
  const showSoftNoticeRef = useRef(null);
  const showResultRef = useRef(null);

  const onRawScan = useCallback(async (raw) => {
    // Sniff first so a Wi-Fi QR or Instagram URL is rejected without a
    // network round-trip.
    const sniff = sniffScan(raw);
    const plan = planScanAttempts(sniff, { eventId, doorSessionId });
    if (plan.requiresEvent) {
      // A ticket QR was scanned but no door session is running. Surface a
      // friendly, actionable result card instead of firing a doomed POST.
      showResultRef.current?.({
        theme: 'amber',
        headline: 'Start an event first',
        subhead: 'Tap Start Event above so this ticket can be checked against a guest list.',
        name: '',
      });
      return;
    }
    if (plan.attempts.length === 0) {
      showSoftNoticeRef.current?.('Not a valid QR — try again.');
      return;
    }

    setPhase('busy');
    setBusyLabel('Checking…');

    // Walk the attempts list in order. For ambiguous_token this is
    // [member, trial-pass]; for everything else it is a single entry.
    for (let i = 0; i < plan.attempts.length; i += 1) {
      const attempt = plan.attempts[i];
      let res;
      let json = null;
      try {
        res = await fetch(attempt.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(attempt.body),
        });
        json = await res.json().catch(() => ({}));
      } catch {
        showResultRef.current?.({
          theme: 'red',
          headline: 'Network error',
          subhead: 'Could not reach the scan endpoint. Try again.',
          name: '',
        });
        return;
      }

      // Ambiguous fall-through: this endpoint said "wrong kind of token",
      // try the next one.
      if (shouldFallThroughAmbiguous({ source: attempt.source, status: res.status, json })) {
        continue;
      }

      if (!res.ok) {
        // Non-fall-through error: surface it verbatim.
        showResultRef.current?.({
          theme: 'red',
          headline: humanStatusHeadline(attempt.source, res.status),
          subhead: json?.error || 'Scan failed.',
          name: '',
        });
        return;
      }

      // Trial-pass "not_a_pass" comes back on 200 — only fall through if the
      // plan expected it (ambiguous_token queued trial-pass second). Otherwise
      // render it as a final result.
      if (attempt.source === 'trial_pass' && json.result === 'not_a_pass') {
        if (plan.kind === 'ambiguous_token') {
          // The token was 32-hex but matched no member AND no pass.
          showResultRef.current?.({
            theme: 'red',
            headline: 'Not recognized',
            subhead: 'This QR did not match a member ID or a trial pass.',
            name: '',
          });
          return;
        }
        showResultRef.current?.({
          theme: 'red',
          headline: 'Not a Trial Pass',
          subhead: json.reason || 'This QR is not a valid pass.',
          name: '',
        });
        return;
      }

      // Real preview — render the card and wait for staff.
      setPreview(buildPreviewVM(attempt.source, attempt.body, json));
      setPhase('preview');
      return;
    }

    // Every attempt fell through — only possible for ambiguous_token where
    // neither member nor trial-pass claimed the token.
    showResultRef.current?.({
      theme: 'red',
      headline: 'Not recognized',
      subhead: 'This QR did not match a member ID or a trial pass.',
      name: '',
    });
  }, [eventId, doorSessionId]);

  const showSoftNotice = useCallback((msg) => {
    setSoftNotice(msg);
    if (softNoticeTimerRef.current) clearTimeout(softNoticeTimerRef.current);
    softNoticeTimerRef.current = setTimeout(() => setSoftNotice(null), 1600);
  }, []);

  const showResult = useCallback((r) => {
    setResult(r);
    setPhase('result');
  }, []);

  // Keep the refs pointed at the latest closures so onRawScan can call them
  // without listing them in its dep array.
  useEffect(() => { showSoftNoticeRef.current = showSoftNotice; }, [showSoftNotice]);
  useEffect(() => { showResultRef.current = showResult; }, [showResult]);

  // Auto-return to scanning after RESULT_HOLD_MS so staff never gets stuck
  // on a card with no explicit dismiss. Preview cards never auto-clear —
  // they need an explicit decision.
  useEffect(() => {
    if (phase !== 'result') return undefined;
    resultHoldTimerRef.current = setTimeout(() => {
      resetToScanning();
    }, RESULT_HOLD_MS);
    return () => {
      if (resultHoldTimerRef.current) clearTimeout(resultHoldTimerRef.current);
    };
  }, [phase]);

  const {
    videoRef,
    phase: scannerPhase,
    cameraErrorMessage,
    torch,
    torchSupported,
    toggleTorch,
  } = useDoorScanner({ enabled: scannerActive && phase === 'scanning', onRawScan });

  function resetToScanning() {
    setPreview(null);
    setResult(null);
    setRejectPicker(false);
    setRejectNote('');
    setDecisionBusy(false);
    setPhase('scanning');
  }

  // resetToScanning is idempotent (all setters); keeping it out of the phase
  // effect's dep array on purpose because the callback re-creates every
  // render and would only cause a needless re-run of the auto-hide timer.

  // ---- Commit (Check In / Verify) ----
  const commitAdmit = useCallback(async () => {
    if (!preview || decisionBusy) return;
    setDecisionBusy(true);
    setBusyLabel(preview.source === 'member_id' ? 'Verifying…' : 'Checking in…');
    setPhase('busy');

    const endpoint = preview.source === 'member_id'
      ? '/api/scan/member-id'
      : '/api/capacity/trial-pass/scan';
    const body = preview.source === 'member_id'
      ? { token: preview.token, mode: 'verify' }
      : { token: preview.token, mode: 'checkin' };
    attachEventContext(body, preview.source, eventId, doorSessionId);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showResult({
          theme: 'red',
          headline: preview.source === 'member_id' ? 'Verify failed' : 'Check-in failed',
          subhead: json.error || 'Try again.',
          name: preview.name,
        });
        return;
      }

      // Trial-pass 'checkin' returns a full result object like the preview
      // did; the terminal decision is json.result. Member-id 'verify'
      // returns {result:'verified'}. Both map to admitted for our purposes.
      const admitted = (preview.source === 'trial_pass' && json.result === 'allowed')
        || (preview.source === 'member_id' && json.result === 'verified');

      let bumpWarning = null;
      if (admitted && getBumpWarning) {
        try {
          bumpWarning = await getBumpWarning({ source: preview.source });
        } catch {
          bumpWarning = null;
        }
        onAdmitted?.({ source: preview.source });
      }

      const theme = admitted ? 'green' : (json.result?.startsWith('denied') ? 'amber' : 'red');
      const headline = admitted
        ? (preview.source === 'member_id' ? 'Verified · Member' : 'Allowed')
        : humanDeniedHeadline(json.result);
      const subhead = admitted
        ? (preview.source === 'member_id' ? 'Wave them in.' : 'Wave them in.')
        : (json.reason || 'Denied at the door.');

      // Log the activity for the recent panel.
      onActivity?.({
        id: preview.activityId,
        kind: preview.source,
        name: preview.name,
        detail: buildActivityDetail(preview, json),
        result: admitted ? 'admitted' : (json.result === 'rejected' ? 'rejected' : 'denied'),
        at: Date.now(),
      });

      showResult({ theme, headline, subhead, name: preview.name, bumpWarning });
    } catch {
      showResult({
        theme: 'red',
        headline: 'Network error',
        subhead: 'Try again.',
        name: preview.name,
      });
    } finally {
      setDecisionBusy(false);
    }
  }, [preview, decisionBusy, showResult, onAdmitted, getBumpWarning, onActivity, eventId, doorSessionId]);

  // ---- Commit (Reject) ----
  const commitReject = useCallback(async (reasonCode) => {
    if (!preview || decisionBusy) return;
    setDecisionBusy(true);
    setBusyLabel('Rejecting…');
    setPhase('busy');

    const endpoint = preview.source === 'member_id'
      ? '/api/scan/member-id'
      : '/api/capacity/trial-pass/scan';
    const body = preview.source === 'member_id'
      ? { token: preview.token, mode: 'reject', reject_reason: reasonCode, note: rejectNote.slice(0, 280) }
      : { token: preview.token, mode: 'reject', reject_reason: reasonCode, note: rejectNote.slice(0, 280) };
    attachEventContext(body, preview.source, eventId, doorSessionId);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        showResult({
          theme: 'red',
          headline: 'Reject failed',
          subhead: json.error || 'Try again.',
          name: preview.name,
        });
        return;
      }
      onActivity?.({
        id: preview.activityId,
        kind: preview.source,
        name: preview.name,
        detail: `Rejected · ${reasonLabel(reasonCode, preview.source)}`,
        result: 'rejected',
        at: Date.now(),
      });
      showResult({
        theme: 'red',
        headline: 'Rejected',
        subhead: `Logged: ${reasonLabel(reasonCode, preview.source)}`,
        name: preview.name,
      });
    } catch {
      showResult({
        theme: 'red',
        headline: 'Network error',
        subhead: 'Try again.',
        name: preview.name,
      });
    } finally {
      setDecisionBusy(false);
      setRejectPicker(false);
      setRejectNote('');
    }
  }, [preview, decisionBusy, rejectNote, showResult, onActivity, eventId, doorSessionId]);

  // ---- Render ----
  return (
    <div
      className="rounded-2xl border overflow-hidden flex flex-col"
      style={{ background: '#111', borderColor: 'rgba(255,255,255,0.08)', minHeight: 520 }}
    >
      <div
        className="px-5 py-4 border-b flex items-baseline justify-between gap-3 flex-wrap"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div>
          <div className="text-[11px] font-bold tracking-[0.16em] uppercase" style={{ color: '#8a8a8a' }}>
            Door Scanner
          </div>
          <h2 className="text-[20px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Scan a QR — Member or Trial Pass
          </h2>
        </div>
        {torchSupported && scannerPhase !== 'camera_error' && (
          <button
            type="button"
            onClick={toggleTorch}
            className="px-3 py-1.5 rounded-lg text-[12px] font-bold"
            style={{
              background: torch ? '#ffb84d' : 'rgba(30,30,30,0.85)',
              color: torch ? '#0a0a0a' : '#f5f5f5',
            }}
          >
            {torch ? 'Torch on' : 'Torch'}
          </button>
        )}
      </div>

      {/* Camera stage — fixed aspect so the panel doesn't reflow between
          scan / preview / result. */}
      <div className="relative w-full" style={{ aspectRatio: '4 / 3', background: '#000' }}>
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ background: '#000' }}
          playsInline
          muted
          autoPlay
        />

        {scannerPhase === 'ready' && phase === 'scanning' && (
          <>
            <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.30)' }} />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="rounded-2xl border-2"
                style={{
                  width: 'min(60%, 320px)',
                  height: 'min(60%, 320px)',
                  borderColor: 'rgba(124,252,155,0.9)',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.30)',
                }}
              />
            </div>
            <div className="absolute inset-x-0 bottom-3 flex justify-center pointer-events-none px-3">
              <div
                className="rounded-lg px-3 py-1.5 text-center"
                style={{ background: 'rgba(0,0,0,0.55)', color: '#e5e5e5' }}
              >
                <div className="text-[13px] font-semibold">
                  {softNotice || 'Hold their QR inside the frame.'}
                </div>
              </div>
            </div>
          </>
        )}

        {phase === 'busy' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="rounded-xl px-5 py-3"
              style={{ background: 'rgba(0,0,0,0.75)', color: '#f5f5f5' }}
            >
              <div className="text-[15px] font-bold">{busyLabel}</div>
            </div>
          </div>
        )}

        {scannerPhase === 'camera_error' && (
          <div
            className="absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center"
            style={{ background: '#0a0a0a' }}
          >
            <div className="text-[11px] font-bold tracking-[0.2em] mb-2" style={{ color: '#ff8a8a' }}>
              CAMERA UNAVAILABLE
            </div>
            <div className="text-[15px] font-bold mb-3" style={{ maxWidth: 360 }}>
              {cameraErrorMessage || 'Camera could not start.'}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg text-[13px] font-bold"
              style={{ background: '#7CFC9B', color: '#0a0a0a' }}
            >
              Reload
            </button>
          </div>
        )}
      </div>

      {/* Preview / result surface sits BELOW the camera stage so the video
          stays visible for context and the operator does not lose their
          place while a card is up. */}
      {phase === 'preview' && preview && (
        <PreviewCard
          preview={preview}
          rejectPicker={rejectPicker}
          rejectNote={rejectNote}
          decisionBusy={decisionBusy}
          onCheckIn={commitAdmit}
          onOpenReject={() => setRejectPicker(true)}
          onCancelReject={() => setRejectPicker(false)}
          onReject={commitReject}
          onRejectNoteChange={setRejectNote}
          onCancelPreview={resetToScanning}
        />
      )}

      {phase === 'result' && result && (
        <ResultCard result={result} onNext={resetToScanning} />
      )}
    </div>
  );
}

// ---- View-model + label helpers ----

function buildPreviewVM(source, requestBody, json) {
  if (source === 'member_id') {
    const m = json.member || {};
    return {
      source: 'member_id',
      token: requestBody.token,
      activityId: `member:${m.memberProfileId || requestBody.token}`,
      name: m.fullName || m.firstName || 'Member',
      firstName: m.firstName || 'Member',
      subhead: (m.isActive ? 'Active' : 'Inactive') + (m.tierLabel ? ` · ${m.tierLabel}` : ''),
      statusLabel: null,
      expiresLabel: null,
      hasPhoto: Boolean(m.hasPhoto),
      photoUrl: m.photoSignedUrl || null,
      linkedTicketNote: json.linked_ticket ? `Ticket: ${json.linked_ticket.product_label || 'General Admission'} — will be checked in` : null,
      isAllowed: Boolean(m.isActive), // an inactive member can still be verified for audit; button stays enabled with warning
      warningBanner: m.isActive ? null : 'Membership is not active. Verify ID or reject with “membership inactive.”',
      buttonLabel: 'Verify Member',
      themeAccent: '#7CFC9B',
    };
  }
  // trial_pass
  const g = json.guest || {};
  const isAllowed = json.result === 'allowed';
  return {
    source: 'trial_pass',
    token: requestBody.token,
    activityId: `trial:${g.passId || requestBody.token}`,
    name: g.firstName || 'Guest',
    firstName: g.firstName || 'Guest',
    subhead: json.reason || (isAllowed ? 'Wave them in.' : 'Denied at the door.'),
    statusLabel: g.statusLabel || null,
    expiresLabel: g.expiresLabel || null,
    hasPhoto: Boolean(g.hasPhoto),
    photoUrl: g.photoSignedUrl || null,
    linkedTicketNote: null,
    isAllowed,
    warningBanner: g.hasPhoto ? null : 'No photo on file. Verify ID or reject with “no photo on file.”',
    buttonLabel: isAllowed ? 'Check In' : 'Check In (denied)',
    themeAccent: isAllowed ? '#7CFC9B' : '#ff8a8a',
  };
}

function buildActivityDetail(preview, json) {
  if (preview.source === 'member_id') {
    const ticket = json.ticket;
    if (ticket && ticket.result === 'valid') return `Member · ticket ${ticket.product_label || 'redeemed'}`;
    return preview.subhead || 'Member scan';
  }
  return preview.statusLabel || preview.expiresLabel || 'Trial pass';
}

function reasonLabel(code, source) {
  const bank = source === 'member_id' ? REJECT_REASONS_MEMBER_ID : REJECT_REASONS_TRIAL_PASS;
  return bank.find((r) => r.code === code)?.label || code;
}

function humanStatusHeadline(source, status) {
  if (source === 'member_id') {
    if (status === 400) return 'Not a Member ID';
    if (status === 404) return 'Unknown Member ID';
    if (status === 410) return 'Revoked';
    if (status === 429) return 'Too many scans';
  }
  return 'Scan failed';
}

function humanDeniedHeadline(code) {
  switch (code) {
    case 'denied_expired': return 'Denied · Expired';
    case 'denied_ineligible_event': return 'Denied · Wrong event';
    case 'denied_duplicate': return 'Denied · Already used tonight';
    case 'rejected': return 'Rejected';
    default: return 'Denied';
  }
}

// ---- Card components ----

function PreviewCard({
  preview, rejectPicker, rejectNote, decisionBusy,
  onCheckIn, onOpenReject, onCancelReject, onReject, onRejectNoteChange, onCancelPreview,
}) {
  const bank = preview.source === 'member_id' ? REJECT_REASONS_MEMBER_ID : REJECT_REASONS_TRIAL_PASS;
  return (
    <section
      className="px-5 py-4 border-t"
      style={{ background: '#0f0f0f', borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <div
        className="text-[11px] font-bold tracking-[0.16em] uppercase mb-2"
        style={{ color: preview.themeAccent }}
      >
        {preview.source === 'member_id' ? 'Member ID · Preview' : 'Trial Pass · Preview'}
      </div>

      <div className="flex gap-4 items-start mb-3">
        <div
          className="rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
          style={{
            width: 112, height: 112,
            background: preview.hasPhoto ? '#000' : 'rgba(0,0,0,0.35)',
            border: preview.hasPhoto ? '2px solid rgba(255,255,255,0.14)' : '2px dashed rgba(217,196,140,0.9)',
          }}
        >
          {preview.hasPhoto && preview.photoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={preview.photoUrl}
              alt="Guest photo on file"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <div className="text-center px-2">
              <div className="text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: '#d9c48c' }}>
                No Photo
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[24px] font-extrabold leading-tight truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {preview.firstName}
          </div>
          {preview.subhead && (
            <div className="text-[13px] font-semibold mt-1" style={{ color: '#c9c9c9' }}>
              {preview.subhead}
            </div>
          )}
          {(preview.statusLabel || preview.expiresLabel) && (
            <div className="text-[12px] mt-0.5" style={{ color: '#8a8a8a' }}>
              {[preview.statusLabel, preview.expiresLabel].filter(Boolean).join(' · ')}
            </div>
          )}
          {preview.linkedTicketNote && (
            <div className="text-[12px] mt-1 font-semibold" style={{ color: '#7CFC9B' }}>
              {preview.linkedTicketNote}
            </div>
          )}
        </div>
      </div>

      {preview.warningBanner && (
        <div
          className="rounded-lg px-3 py-2 mb-3 text-[12px] font-semibold"
          style={{ background: 'rgba(217,196,140,0.14)', color: '#d9c48c' }}
        >
          {preview.warningBanner}
        </div>
      )}

      {rejectPicker ? (
        <div>
          <div className="text-[11px] font-bold tracking-[0.16em] uppercase mb-2" style={{ color: '#ff8a8a' }}>
            Reject reason
          </div>
          <div className="grid grid-cols-2 gap-2 mb-2">
            {bank.map((r) => (
              <button
                key={r.code}
                type="button"
                disabled={decisionBusy}
                onClick={() => onReject(r.code)}
                className="rounded-lg py-2.5 text-[13px] font-bold active:scale-[0.98] transition-transform"
                style={{
                  background: 'rgba(255,138,138,0.16)',
                  color: '#ffd6d6',
                  border: '1px solid rgba(255,138,138,0.35)',
                  opacity: decisionBusy ? 0.6 : 1,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
          <textarea
            value={rejectNote}
            onChange={(e) => onRejectNoteChange(e.target.value)}
            placeholder="Optional note (max 280 chars)"
            maxLength={280}
            className="w-full rounded-lg p-2 text-[13px] mb-2"
            style={{
              background: '#0a0a0a', color: '#f5f5f5',
              border: '1px solid rgba(255,255,255,0.08)',
              minHeight: 52,
              fontFamily: "'Plus Jakarta Sans', sans-serif",
            }}
          />
          <button
            type="button"
            onClick={onCancelReject}
            disabled={decisionBusy}
            className="w-full rounded-lg py-2 text-[13px] font-bold"
            style={{ background: 'rgba(30,30,30,0.85)', color: '#f5f5f5' }}
          >
            Back
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={onCheckIn}
            disabled={decisionBusy}
            className="w-full rounded-xl py-3 text-[16px] font-extrabold active:scale-[0.98] transition-transform"
            style={{
              background: '#7CFC9B',
              color: '#0a2410',
              fontFamily: "'Plus Jakarta Sans', sans-serif",
              opacity: decisionBusy ? 0.6 : 1,
            }}
          >
            {decisionBusy ? 'Working…' : preview.buttonLabel}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onOpenReject}
              disabled={decisionBusy}
              className="rounded-lg py-2 text-[13px] font-bold active:scale-[0.98] transition-transform"
              style={{
                background: '#ff8a8a',
                color: '#2a0a0a',
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                opacity: decisionBusy ? 0.6 : 1,
              }}
            >
              Reject
            </button>
            <button
              type="button"
              onClick={onCancelPreview}
              disabled={decisionBusy}
              className="rounded-lg py-2 text-[13px] font-bold"
              style={{ background: 'rgba(30,30,30,0.85)', color: '#c9c9c9' }}
            >
              Cancel · re-scan
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function ResultCard({ result, onNext }) {
  const theme = themeFor(result.theme);
  return (
    <section
      className="px-5 py-4 border-t"
      style={{ background: theme.background, borderColor: theme.border, color: theme.foreground }}
    >
      <div className="text-[11px] font-bold tracking-[0.18em] uppercase mb-1" style={{ color: theme.accent }}>
        {result.headline}
      </div>
      {result.name && (
        <div className="text-[28px] font-extrabold leading-tight mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {result.name}
        </div>
      )}
      {result.subhead && (
        <div className="text-[14px] font-semibold" style={{ color: theme.foreground }}>
          {result.subhead}
        </div>
      )}
      {result.bumpWarning && (
        <div
          className="rounded-lg px-3 py-2 mt-2 text-[12px] font-semibold"
          style={{ background: 'rgba(255,184,77,0.16)', color: '#ffb84d' }}
        >
          {result.bumpWarning}
        </div>
      )}
      <button
        type="button"
        onClick={onNext}
        className="w-full mt-3 rounded-xl py-3 text-[15px] font-extrabold active:scale-[0.98] transition-transform"
        style={{ background: theme.buttonBg, color: theme.buttonFg, fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Next guest
      </button>
    </section>
  );
}

function themeFor(name) {
  if (name === 'green') {
    return {
      background: '#0d3d1c', border: 'rgba(124,252,155,0.35)',
      foreground: '#e8ffe8', accent: '#7CFC9B',
      buttonBg: '#7CFC9B', buttonFg: '#0a2410',
    };
  }
  if (name === 'amber') {
    return {
      background: '#3d2a0d', border: 'rgba(255,184,77,0.35)',
      foreground: '#fff2d9', accent: '#ffb84d',
      buttonBg: '#ffb84d', buttonFg: '#2a1c05',
    };
  }
  return {
    background: '#3d1010', border: 'rgba(255,138,138,0.35)',
    foreground: '#ffecec', accent: '#ff8a8a',
    buttonBg: '#ff8a8a', buttonFg: '#2a0a0a',
  };
}

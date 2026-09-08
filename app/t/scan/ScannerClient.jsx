'use client';
import { useEffect, useRef, useState } from 'react';

// Door-scanner UI (PR C). Two-phase flow so staff can visually verify the
// buyer's face BEFORE the ticket is consumed:
//
//   1. Operator scans / pastes a code → POST /api/tickets/scan mode:'preview'
//      Endpoint validates the ticket + returns buyer name + photo signed URL.
//   2. Operator sees the big photo card + result. They tap:
//        • CHECK IN                → POST mode:'checkin' (flips status)
//        • REJECT BUYER NOT PRESENT → picks a reason → POST mode:'reject'
//        • Admin override (when result is not valid)  → mode:'checkin', override:true
//
// Rejection does NOT consume the ticket, so the real buyer can still enter
// if a rejected person was a friend who received a forwarded QR.

const RESULT_COPY = {
  valid: { label: 'VALID TICKET', color: '#0a7a2f', desc: 'This ticket is valid for entry.' },
  already_used: { label: 'ALREADY USED', color: '#a55b00', desc: 'This ticket has already been scanned.' },
  refunded: { label: 'REFUNDED', color: '#a00', desc: 'This ticket was refunded.' },
  void: { label: 'VOID', color: '#a00', desc: 'This ticket is void.' },
  wrong_event: { label: 'WRONG EVENT', color: '#a00', desc: 'This ticket is for a different event.' },
  not_found: { label: 'NOT FOUND', color: '#a00', desc: 'Unknown ticket code.' },
  override: { label: 'OVERRIDDEN', color: '#0a7a2f', desc: 'Admin override — admitted.' },
  rejected: { label: 'REJECTED', color: '#a00', desc: 'Buyer turned away at the door.' },
};

const REJECT_REASONS = [
  { value: 'photo_mismatch', label: 'Photo doesn’t match' },
  { value: 'no_photo_on_file', label: 'No photo on file' },
  { value: 'id_mismatch', label: 'ID doesn’t match' },
  { value: 'manual', label: 'Other (add a note)' },
];

// Design tokens matching the rest of the app dark UI. Inlined so the
// scanner works on a lightweight door tablet without a Tailwind pass.
const TOKENS = {
  bg: '#0a0a0a',
  panel: '#111',
  panelAlt: '#0f0f0f',
  border: 'rgba(255,255,255,0.08)',
  text: '#f5f5f5',
  muted: '#8a8a8a',
  subdued: '#c9c9c9',
  gold: '#d9c48c',
  green: '#8fe0a5',
  red: '#ff8686',
  greenBg: 'rgba(74,222,128,0.10)',
  greenBorder: 'rgba(74,222,128,0.35)',
  redBg: 'rgba(255,90,90,0.10)',
  redBorder: 'rgba(255,90,90,0.35)',
  goldBg: 'rgba(217,196,140,0.10)',
  goldBorder: 'rgba(217,196,140,0.40)',
};

export default function ScannerClient({ prefillCode = '' }) {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [code, setCode] = useState(prefillCode);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);

  // Preview state — the big photo card between scan and check-in/reject.
  const [preview, setPreview] = useState(null); // { code, result, reason, ticket, buyer }
  const [showRejectPicker, setShowRejectPicker] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [flashMessage, setFlashMessage] = useState(''); // "Checked in", "Rejected: photo mismatch", etc.

  const inputRef = useRef(null);

  useEffect(() => {
    fetch('/api/tickets/scanner-events')
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((d) => setEvents(d.events || []))
      .catch(() => setEvents([]));
    const storedEvent = typeof window !== 'undefined' ? localStorage.getItem('sdg_scanner_event') : null;
    if (storedEvent) setEventId(storedEvent);
    const storedLabel = typeof window !== 'undefined' ? localStorage.getItem('sdg_scanner_device') : '';
    if (storedLabel) setDeviceLabel(storedLabel);
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (eventId && typeof window !== 'undefined') localStorage.setItem('sdg_scanner_event', eventId);
  }, [eventId]);
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('sdg_scanner_device', deviceLabel || '');
  }, [deviceLabel]);

  async function runScan(mode, extras = {}) {
    if (!eventId || busy) return null;
    const scanCode = extras.code || code;
    if (!scanCode) return null;
    setBusy(true);
    try {
      const res = await fetch('/api/tickets/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: scanCode,
          event_id: eventId,
          device_label: deviceLabel,
          mode,
          ...extras,
        }),
      });
      const data = await res.json().catch(() => ({}));
      return { ...data, code: scanCode };
    } catch (err) {
      return { code: scanCode, result: 'error', reason: String(err?.message || err) };
    } finally {
      setBusy(false);
    }
  }

  async function submitPreview() {
    setFlashMessage('');
    setShowRejectPicker(false);
    setRejectNote('');
    const result = await runScan('preview');
    if (!result) return;
    setPreview(result);
    setCode('');
    // Do NOT re-focus the input yet — operator needs to look at the card.
  }

  async function submitCheckin(override = false) {
    if (!preview) return;
    const result = await runScan('checkin', {
      code: preview.code,
      override,
      note: null,
    });
    if (!result) return;
    setHistory((h) => [
      { at: new Date().toISOString(), buyerName: preview.buyer?.displayName, ...result },
      ...h,
    ].slice(0, 20));
    setFlashMessage(
      result.result === 'valid'
        ? 'Checked in.'
        : result.result === 'override'
          ? 'Overridden and admitted.'
          : `Blocked (${RESULT_COPY[result.result]?.label || result.result}).`,
    );
    setPreview(null);
    inputRef.current?.focus();
  }

  async function submitReject(reason) {
    if (!preview) return;
    const result = await runScan('reject', {
      code: preview.code,
      reject_reason: reason,
      note: rejectNote.trim() || null,
    });
    if (!result) return;
    setHistory((h) => [
      { at: new Date().toISOString(), buyerName: preview.buyer?.displayName, ...result },
      ...h,
    ].slice(0, 20));
    const reasonLabel = REJECT_REASONS.find((r) => r.value === reason)?.label || reason;
    setFlashMessage(`Rejected — ${reasonLabel}. Ticket is still valid for the real buyer.`);
    setPreview(null);
    setShowRejectPicker(false);
    setRejectNote('');
    inputRef.current?.focus();
  }

  function cancelPreview() {
    setPreview(null);
    setShowRejectPicker(false);
    setRejectNote('');
    setFlashMessage('');
    inputRef.current?.focus();
  }

  // ------------------------------------------------------------ render
  const showingPreview = Boolean(preview);
  const previewCopy = preview ? RESULT_COPY[preview.result] : null;
  const isValid = preview?.result === 'valid';
  const canCheckin = isValid;
  const canOverride = preview && !isValid && preview.result !== 'override';

  return (
    <div style={{ color: TOKENS.text, fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      {/* Event + device controls */}
      {!showingPreview && (
        <>
          <FieldLabel>EVENT</FieldLabel>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            style={selectStyle}
          >
            <option value="">Select an event…</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>{e.title} — {e.event_date}</option>
            ))}
          </select>

          <FieldLabel style={{ marginTop: 16 }}>DEVICE LABEL (OPTIONAL)</FieldLabel>
          <input
            value={deviceLabel}
            onChange={(e) => setDeviceLabel(e.target.value)}
            placeholder="Front door scanner"
            style={inputStyle}
          />

          <form onSubmit={(e) => { e.preventDefault(); submitPreview(); }} style={{ marginTop: 20 }}>
            <FieldLabel>TICKET CODE</FieldLabel>
            <input
              ref={inputRef}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="SDGA-XXXX-XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              style={{ ...inputStyle, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 18 }}
            />
            <button
              type="submit"
              disabled={!eventId || !code || busy}
              style={{ ...primaryButton, marginTop: 12, opacity: (!eventId || !code || busy) ? 0.5 : 1 }}
            >
              {busy ? 'SCANNING…' : 'SCAN'}
            </button>
          </form>

          {flashMessage && (
            <div
              style={{
                marginTop: 16,
                padding: '10px 14px',
                borderRadius: 2,
                background: TOKENS.panelAlt,
                border: `1px solid ${TOKENS.border}`,
                fontSize: 13,
                color: TOKENS.subdued,
              }}
            >
              {flashMessage}
            </div>
          )}
        </>
      )}

      {/* Preview card: photo + result + big Check In / Reject buttons */}
      {showingPreview && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <PreviewHeader result={preview.result} copy={previewCopy} />

          <div
            style={{
              background: TOKENS.panel,
              border: `1px solid ${TOKENS.border}`,
              borderRadius: 4,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <PhotoDisplay
              signedUrl={preview.buyer?.photoSignedUrl}
              hasPhoto={preview.buyer?.hasPhoto}
              displayName={preview.buyer?.displayName}
            />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>
                {preview.buyer?.displayName || <span style={{ color: TOKENS.muted }}>No name on file</span>}
              </div>
              {preview.buyer?.email && (
                <div style={{ fontSize: 13, color: TOKENS.muted, marginTop: 4 }}>
                  {preview.buyer.email}
                </div>
              )}
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: TOKENS.muted, marginTop: 10 }}>
                {preview.code}
              </div>
            </div>
          </div>

          {!showRejectPicker && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button
                type="button"
                onClick={() => submitCheckin(false)}
                disabled={!canCheckin || busy}
                style={{
                  ...bigButton,
                  background: canCheckin ? '#0a7a2f' : '#333',
                  color: '#fff',
                  opacity: (!canCheckin || busy) ? 0.6 : 1,
                }}
              >
                {busy ? '…' : 'CHECK IN'}
              </button>
              <button
                type="button"
                onClick={() => setShowRejectPicker(true)}
                disabled={busy}
                style={{
                  ...bigButton,
                  background: '#a00',
                  color: '#fff',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                REJECT
              </button>
            </div>
          )}

          {showRejectPicker && (
            <RejectPicker
              reasons={REJECT_REASONS}
              note={rejectNote}
              onNoteChange={setRejectNote}
              onSelect={submitReject}
              onCancel={() => { setShowRejectPicker(false); setRejectNote(''); }}
              busy={busy}
            />
          )}

          {canOverride && !showRejectPicker && (
            <button
              type="button"
              onClick={() => submitCheckin(true)}
              disabled={busy}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: `1px solid ${TOKENS.goldBorder}`,
                color: TOKENS.gold,
                padding: '10px 12px',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                borderRadius: 2,
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.6 : 1,
              }}
            >
              ADMIN OVERRIDE + CHECK IN
            </button>
          )}

          <button
            type="button"
            onClick={cancelPreview}
            disabled={busy}
            style={{
              appearance: 'none',
              background: 'transparent',
              border: 'none',
              color: TOKENS.muted,
              padding: 8,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            CANCEL / SCAN ANOTHER
          </button>
        </div>
      )}

      {/* Recent scans */}
      {!showingPreview && history.length > 0 && (
        <details style={{ marginTop: 24, color: TOKENS.subdued }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            RECENT SCANS ({history.length})
          </summary>
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 10 }}>
            {history.map((h, i) => {
              const copy = RESULT_COPY[h.result];
              return (
                <li
                  key={i}
                  style={{
                    padding: '10px 12px',
                    borderBottom: `1px solid ${TOKENS.border}`,
                    fontSize: 13,
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <span style={{ color: copy?.color === '#0a7a2f' ? TOKENS.green : copy?.color === '#a00' ? TOKENS.red : TOKENS.gold, fontWeight: 700 }}>
                    {copy?.label || h.result}
                  </span>
                  <span style={{ color: TOKENS.muted, textAlign: 'right', minWidth: 0 }}>
                    {h.buyerName ? <span style={{ color: TOKENS.subdued }}>{h.buyerName} · </span> : null}
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>{h.code}</span>
                    {h.reject_reason && <span> · {h.reject_reason.replace(/_/g, ' ')}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function FieldLabel({ children, style }) {
  return (
    <label
      style={{
        display: 'block',
        fontSize: 11,
        letterSpacing: '0.14em',
        fontWeight: 700,
        textTransform: 'uppercase',
        color: TOKENS.muted,
        marginBottom: 8,
        ...(style || {}),
      }}
    >
      {children}
    </label>
  );
}

function PreviewHeader({ result, copy }) {
  const isGreen = result === 'valid' || result === 'override';
  const isRed = ['refunded', 'void', 'wrong_event', 'not_found'].includes(result);
  const bg = isGreen ? TOKENS.greenBg : isRed ? TOKENS.redBg : TOKENS.goldBg;
  const border = isGreen ? TOKENS.greenBorder : isRed ? TOKENS.redBorder : TOKENS.goldBorder;
  const color = isGreen ? TOKENS.green : isRed ? TOKENS.red : TOKENS.gold;
  return (
    <div
      style={{
        padding: '14px 16px',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', color, marginBottom: 4 }}>
        {copy?.label || result?.toUpperCase()}
      </div>
      <div style={{ fontSize: 13, color: TOKENS.subdued, lineHeight: 1.5 }}>
        {copy?.desc || 'Result unknown.'}
      </div>
    </div>
  );
}

function PhotoDisplay({ signedUrl, hasPhoto, displayName }) {
  const size = 220;
  if (hasPhoto && signedUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={signedUrl}
        alt={displayName ? `Photo of ${displayName}` : 'Buyer photo'}
        style={{
          width: size,
          height: size,
          objectFit: 'cover',
          borderRadius: 6,
          border: `1px solid ${TOKENS.border}`,
          background: '#000',
        }}
      />
    );
  }
  // No photo — big warning tile telling staff to select the "no photo" reject
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        border: `2px dashed ${TOKENS.goldBorder}`,
        background: TOKENS.goldBg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: TOKENS.gold,
        padding: 12,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 6, fontWeight: 700 }}>!</div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', marginBottom: 4 }}>
        NO PHOTO ON FILE
      </div>
      <div style={{ fontSize: 11, color: TOKENS.subdued, lineHeight: 1.4 }}>
        Reject with reason “no photo on file” unless you can verify ID.
      </div>
    </div>
  );
}

function RejectPicker({ reasons, note, onNoteChange, onSelect, onCancel, busy }) {
  return (
    <div
      style={{
        background: TOKENS.panelAlt,
        border: `1px solid ${TOKENS.border}`,
        borderRadius: 4,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: TOKENS.red, marginBottom: 4 }}>
        WHY ARE YOU REJECTING?
      </div>
      {reasons.map((r) => (
        <button
          key={r.value}
          type="button"
          onClick={() => onSelect(r.value)}
          disabled={busy}
          style={{
            appearance: 'none',
            textAlign: 'left',
            padding: '14px 16px',
            background: TOKENS.panel,
            border: `1px solid ${TOKENS.border}`,
            color: TOKENS.text,
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 2,
            cursor: busy ? 'default' : 'pointer',
            opacity: busy ? 0.6 : 1,
            fontFamily: "'Plus Jakarta Sans', sans-serif",
          }}
        >
          {r.label}
        </button>
      ))}
      <label style={{ display: 'block', fontSize: 11, letterSpacing: '0.14em', fontWeight: 700, color: TOKENS.muted, marginTop: 6 }}>
        NOTE (OPTIONAL)
      </label>
      <input
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="What happened?"
        maxLength={280}
        style={{ ...inputStyle, marginBottom: 0 }}
      />
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        style={{
          appearance: 'none',
          background: 'transparent',
          border: 'none',
          color: TOKENS.muted,
          padding: 8,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          fontFamily: "'Plus Jakarta Sans', sans-serif",
        }}
      >
        CANCEL
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline styles used across the module
// ---------------------------------------------------------------------------
const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  background: TOKENS.panel,
  border: `1px solid ${TOKENS.border}`,
  borderRadius: 2,
  color: TOKENS.text,
  fontSize: 14,
  outline: 'none',
  fontFamily: "'Plus Jakarta Sans', sans-serif",
  marginBottom: 4,
};

const selectStyle = {
  ...inputStyle,
  appearance: 'none',
};

const primaryButton = {
  appearance: 'none',
  width: '100%',
  padding: '16px 18px',
  background: '#fff',
  color: '#0a0a0a',
  border: 'none',
  borderRadius: 2,
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  fontFamily: "'Plus Jakarta Sans', sans-serif",
};

const bigButton = {
  appearance: 'none',
  padding: '22px 12px',
  border: 'none',
  borderRadius: 4,
  fontSize: 15,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  fontFamily: "'Plus Jakarta Sans', sans-serif",
};

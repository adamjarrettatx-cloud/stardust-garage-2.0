'use client';
import { useEffect, useRef, useState } from 'react';

// Door-scanner UI. Lets a team member:
//   * Pick an event to scan for (persisted in localStorage).
//   * Paste or type a code + submit. The scan endpoint enforces admin gate
//     and status transitions atomically; this UI just narrates the result.
//   * See the last N scan attempts inline.
//
// A camera-based QR scan can be layered on later by wiring a lib
// (jsQR, zxing) into the same submitScan() call. Kept out of this PR to
// avoid bundling a new dep before the door workflow is validated end-to-end.

const RESULT_COPY = {
  valid: { label: 'ADMIT', color: '#0a7a2f', desc: 'Ticket is valid.' },
  already_used: { label: 'ALREADY USED', color: '#a55b00', desc: 'This ticket has already been scanned.' },
  refunded: { label: 'REFUNDED', color: '#a00', desc: 'This ticket was refunded.' },
  void: { label: 'VOID', color: '#a00', desc: 'This ticket is void.' },
  wrong_event: { label: 'WRONG EVENT', color: '#a00', desc: 'This ticket is for a different event.' },
  not_found: { label: 'NOT FOUND', color: '#a00', desc: 'Unknown ticket code.' },
  override: { label: 'OVERRIDDEN', color: '#0a7a2f', desc: 'Admin override — admitted.' },
};

export default function ScannerClient({ prefillCode = '' }) {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [code, setCode] = useState(prefillCode);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    fetch('/api/tickets/scanner-events')
      .then((r) => r.ok ? r.json() : { events: [] })
      .then((d) => setEvents(d.events || []))
      .catch(() => setEvents([]));
    const stored = typeof window !== 'undefined' ? localStorage.getItem('sdg_scanner_event') : null;
    if (stored) setEventId(stored);
    const label = typeof window !== 'undefined' ? localStorage.getItem('sdg_scanner_device') : '';
    if (label) setDeviceLabel(label);
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (eventId && typeof window !== 'undefined') localStorage.setItem('sdg_scanner_event', eventId);
  }, [eventId]);
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('sdg_scanner_device', deviceLabel || '');
  }, [deviceLabel]);

  async function submitScan(override = false) {
    if (!eventId || !code || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/tickets/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, event_id: eventId, device_label: deviceLabel, override }),
      });
      const data = await res.json();
      setHistory((h) => [{ code, at: new Date().toISOString(), ...data }, ...h].slice(0, 20));
    } catch (err) {
      setHistory((h) => [{ code, at: new Date().toISOString(), result: 'error', reason: String(err?.message || err) }, ...h].slice(0, 20));
    } finally {
      setBusy(false);
      setCode('');
      inputRef.current?.focus();
    }
  }

  const last = history[0];
  const lastCopy = last ? RESULT_COPY[last.result] : null;

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#666' }}>Event</label>
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={{ width: '100%', padding: 8 }}>
          <option value="">Select an event…</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>{e.title} — {e.event_date}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#666' }}>Device label (optional)</label>
        <input
          value={deviceLabel}
          onChange={(e) => setDeviceLabel(e.target.value)}
          placeholder="Front door iPad"
          style={{ width: '100%', padding: 8 }}
        />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); submitScan(false); }} style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', fontSize: 12, color: '#666' }}>Ticket code</label>
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="SDGA-XXXX-XXXX-XXXX-XXXX-XXXX"
          style={{ width: '100%', padding: 12, fontFamily: 'monospace', fontSize: 16 }}
          autoComplete="off"
        />
        <button type="submit" disabled={!eventId || !code || busy} style={{ marginTop: 8, width: '100%', padding: 14, background: '#111', color: '#fff', fontSize: 16, border: 0 }}>
          {busy ? 'Checking…' : 'Scan'}
        </button>
      </form>

      {lastCopy && (
        <div style={{ padding: 20, background: '#fafafa', border: `2px solid ${lastCopy.color}`, borderRadius: 8, marginBottom: 12 }}>
          <div style={{ color: lastCopy.color, fontWeight: 700, fontSize: 20 }}>{lastCopy.label}</div>
          <div style={{ color: '#333', marginTop: 4 }}>{lastCopy.desc}</div>
          <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#666', marginTop: 8 }}>{last.code}</div>
          {last.result !== 'valid' && last.result !== 'override' && (
            <button onClick={() => submitScan(true)} style={{ marginTop: 8, padding: '6px 10px' }} disabled={busy}>
              Admin override
            </button>
          )}
        </div>
      )}

      {history.length > 0 && (
        <details>
          <summary>Recent scans ({history.length})</summary>
          <ul style={{ listStyle: 'none', padding: 0, marginTop: 8 }}>
            {history.map((h, i) => (
              <li key={i} style={{ padding: '6px 0', borderBottom: '1px solid #eee', fontSize: 13 }}>
                <span style={{ color: RESULT_COPY[h.result]?.color || '#666' }}>{RESULT_COPY[h.result]?.label || h.result}</span>
                {' — '}<span style={{ fontFamily: 'monospace' }}>{h.code}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

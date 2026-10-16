'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ATTENDANCE_OPTIONS, groupCalendarMonths, longDateLabel, timeLabel,
} from '@/lib/date-pitches';
import { PREVIEW_ONLY_MESSAGE } from '@/lib/view-portal/preview-only';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const v = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
  return { value: v, label: timeLabel(v) };
});

function publicTime(day) {
  return [day.event_time, day.event_end_time].filter(Boolean).join(' – ');
}

function Drawer({ labelId, onClose, children, className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => ref.current?.querySelector('input, textarea, select, button, a')?.focus(), 0);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); };
  }, [onClose]);
  return (
    <div className="pg-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`pg-drawer ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelId}>
        {children}
      </div>
    </div>
  );
}

function CloseButton({ onClose }) {
  return <button type="button" className="pg-ibtn" onClick={onClose} aria-label="Close">&#10005;</button>;
}

function PitchForm({ date, onClose, onSent, previewOnly }) {
  const [form, setForm] = useState({ title: '', concept: '', lineup: '', startTime: '22:00', endTime: '02:00', expectedAttendance: '100_250', notes: '' });
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (sending || previewOnly) return;
    setError('');
    setSending(true);
    try {
      const res = await fetch('/api/portal/pitches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, date }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'The pitch could not be sent.');
      onSent();
    } catch (err) {
      setError(err.message);
      setSending(false);
    }
  };

  return (
    <Drawer labelId="pg-pitch-title" onClose={onClose}>
      <header>
        <div><h2 id="pg-pitch-title">Pitch this date</h2><div className="when">{longDateLabel(date)} · Open</div></div>
        <CloseButton onClose={onClose} />
      </header>
      <form onSubmit={submit}>
        <div className="pg-field"><label htmlFor="pg-f1">Event name (working title)</label>
          <input id="pg-f1" required maxLength={120} value={form.title} onChange={set('title')} placeholder="e.g. Velvet Static: Shoegaze Night" /></div>
        <div className="pg-field"><label htmlFor="pg-f2">Concept</label>
          <textarea id="pg-f2" required maxLength={4000} value={form.concept} onChange={set('concept')} placeholder="What's the night, who is it for, what makes it worth doing here?" /></div>
        <div className="pg-field"><label htmlFor="pg-f3">Proposed lineup (optional)</label>
          <input id="pg-f3" maxLength={2000} value={form.lineup} onChange={set('lineup')} placeholder="Artists, DJs or acts you have in mind" /></div>
        <div className="pg-row2">
          <div className="pg-field"><label htmlFor="pg-f4">Start time</label>
            <select id="pg-f4" value={form.startTime} onChange={set('startTime')}>{TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
          <div className="pg-field"><label htmlFor="pg-f5">End time</label>
            <select id="pg-f5" value={form.endTime} onChange={set('endTime')}>{TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        </div>
        <div className="pg-field"><label htmlFor="pg-f6">Expected attendance</label>
          <select id="pg-f6" value={form.expectedAttendance} onChange={set('expectedAttendance')}>{ATTENDANCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
        <div className="pg-field"><label htmlFor="pg-f7">Anything else (optional)</label>
          <textarea id="pg-f7" style={{ minHeight: 70 }} maxLength={2000} value={form.notes} onChange={set('notes')} placeholder="Ticket price idea, production needs, links" /></div>
        <div className="pg-note">Pitching doesn&apos;t hold the date. It stays open until SDG approves a pitch for it.</div>
        {previewOnly && <div className="pg-note pg-preview" role="status">{PREVIEW_ONLY_MESSAGE}</div>}
        {error && <p className="pg-error" role="alert">{error}</p>}
        <div className="pg-actions">
          <button type="button" className="pg-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="pg-btn primary" disabled={sending || previewOnly} title={previewOnly ? 'View-only in View Portal' : undefined}>{sending ? 'Sending…' : 'Send pitch'}</button>
        </div>
      </form>
    </Drawer>
  );
}

function PublicEvent({ day, onClose }) {
  return (
    <Drawer labelId="pg-pub-title" onClose={onClose} className="pg-evd">
      <header>
        <div><h2 id="pg-pub-title">{day.title}</h2><div className="when" style={{ color: 'var(--hub-muted)' }}>Public event</div></div>
        <CloseButton onClose={onClose} />
      </header>
      <dl><dt>Date</dt><dd>{longDateLabel(day.day)}</dd>{publicTime(day) && <><dt>Time</dt><dd>{publicTime(day)}</dd></>}</dl>
      {day.slug && <div className="pg-actions" style={{ justifyContent: 'flex-start' }}>
        <a className="pg-btn" href={`/events/${encodeURIComponent(day.slug)}`} target="_blank" rel="noopener noreferrer">View public event page ›</a>
      </div>}
      <div className="pg-note" style={{ marginTop: 18 }}>Shows only what&apos;s already on sdgatx.com/events.</div>
    </Drawer>
  );
}

function MyPitch({ pitch, onClose, onWithdrawn, previewOnly }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const withdraw = async () => {
    if (previewOnly) return;
    setBusy(true); setError('');
    const res = await fetch(`/api/portal/pitches/${pitch.id}/withdraw`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || 'The pitch could not be withdrawn.'); setBusy(false); return; }
    onWithdrawn();
  };
  return (
    <Drawer labelId="pg-mine-title" onClose={onClose} className="pg-evd">
      <header>
        <div><h2 id="pg-mine-title">{pitch.title}</h2><div className="when" style={{ color: 'var(--pend-text)' }}>Your pitch · Pending</div></div>
        <CloseButton onClose={onClose} />
      </header>
      <dl><dt>Date</dt><dd>{longDateLabel(pitch.pitch_date)}</dd><dt>Sent</dt><dd>{new Date(pitch.created_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' })}</dd></dl>
      {error && <p className="pg-error" role="alert">{error}</p>}
      <div className="pg-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="pg-btn" onClick={withdraw} disabled={busy || previewOnly}>{busy ? 'Withdrawing…' : 'Withdraw pitch'}</button>
      </div>
      {previewOnly && <div className="pg-note pg-preview" role="status" style={{ marginTop: 18 }}>{PREVIEW_ONLY_MESSAGE}</div>}
    </Drawer>
  );
}

export default function ProgrammingCalendar({ days, pitches, previewOnly = false }) {
  const router = useRouter();
  const months = useMemo(() => groupCalendarMonths(days), [days]);
  const [index, setIndex] = useState(0);
  const [drawer, setDrawer] = useState(null);
  const [toast, setToast] = useState('');
  const pendingByDate = useMemo(() => {
    const map = new Map();
    for (const p of pitches) if (p.status === 'pending') map.set(p.pitch_date, p);
    return map;
  }, [pitches]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const done = (message) => { setDrawer(null); setToast(message); router.refresh(); };

  if (!months.length) {
    return <div className="pg-empty">The calendar could not be loaded. Refresh the page to try again.</div>;
  }
  const month = months[Math.min(index, months.length - 1)];
  const firstDay = Number(month.days[0].day.slice(8, 10));
  const leading = month.firstWeekday;

  const cells = [];
  for (let i = 0; i < leading; i += 1) cells.push(<div key={`b${i}`} aria-hidden="true" />);
  // Days of the first month before today are shown as past.
  for (let d = 1; d < firstDay; d += 1) {
    cells.push(<div key={`p${d}`} className="pg-day past"><time>{d}</time><span className="t">Past</span></div>);
  }
  for (const day of month.days) {
    const n = Number(day.day.slice(8, 10));
    const label = longDateLabel(day.day);
    const mine = pendingByDate.get(day.day);
    if (day.state === 'public') {
      cells.push(<button key={day.day} type="button" className="pg-day pub" aria-label={`${label}: ${day.title}`} onClick={() => setDrawer({ kind: 'public', day })}>
        <time>{n}</time><span className="ev">{day.title}</span>{publicTime(day) && <span className="t">{publicTime(day)}</span>}
      </button>);
    } else if (day.state === 'unavailable') {
      cells.push(<div key={day.day} className="pg-day un" aria-label={`${label}: Unavailable`}><time>{n}</time><span className="t">Unavailable</span></div>);
    } else if (mine) {
      cells.push(<button key={day.day} type="button" className="pg-day pend" aria-label={`${label}: your pitch, pending`} onClick={() => setDrawer({ kind: 'mine', pitch: mine })}>
        <time>{n}</time><span className="t">Your pitch · Pending</span>
      </button>);
    } else {
      cells.push(<button key={day.day} type="button" className="pg-day open" aria-label={`${label}: Open. Pitch this date`} onClick={() => setDrawer({ kind: 'pitch', date: day.day })}>
        <time>{n}</time><span className="t">Open</span><span className="add">+ Pitch this date</span>
      </button>);
    }
  }

  return (
    <>
      <div className="pg-panel">
        <div className="pg-toolbar">
          <div className="pg-month">
            <button type="button" className="pg-ibtn" aria-label="Previous month" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>&#8249;</button>
            <h2 aria-live="polite">{month.label}</h2>
            <button type="button" className="pg-ibtn" aria-label="Next month" disabled={index >= months.length - 1} onClick={() => setIndex((i) => Math.min(months.length - 1, i + 1))}>&#8250;</button>
          </div>
          <div className="pg-legend">
            <span><i className="pg-sw open" />Open</span>
            <span><i className="pg-sw pub" />Public event</span>
            <span><i className="pg-sw un" />Unavailable</span>
            <span><i className="pg-sw pend" />Your pitch</span>
          </div>
        </div>
        <div className="pg-grid">
          {WEEKDAYS.map((d) => <div key={d} className="pg-wd">{d}</div>)}
          {cells}
        </div>
        <div className="pg-foot"><span>Dates in Austin time. Showing the next 12 months.</span><span>An open date is not reserved until SDG approves your pitch.</span></div>
      </div>
      {drawer?.kind === 'pitch' && <PitchForm date={drawer.date} previewOnly={previewOnly} onClose={() => setDrawer(null)} onSent={() => done('Pitch sent. SDG will review it.')} />}
      {drawer?.kind === 'public' && <PublicEvent day={drawer.day} onClose={() => setDrawer(null)} />}
      {drawer?.kind === 'mine' && <MyPitch pitch={drawer.pitch} previewOnly={previewOnly} onClose={() => setDrawer(null)} onWithdrawn={() => done('Pitch withdrawn.')} />}
      {toast && <div className="pg-toast" role="status">{toast}</div>}
    </>
  );
}

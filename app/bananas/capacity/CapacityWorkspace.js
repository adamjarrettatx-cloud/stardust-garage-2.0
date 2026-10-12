'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCapacity } from '@/app/capacity/useCapacity';
import CapacityAnalyticsClient from './CapacityAnalyticsClient';
import DeviceManager from './DeviceManager';
import styles from './workspace.module.css';

// /bananas/capacity — the single admin home for venue capacity.
//
// Replaces the old /capacity tile hub and /capacity/admin setup page:
//   * Live card      — current count + session controls (start / set / reset / end)
//   * Stations       — launch buttons for each door device page (those pages
//                      stay at /capacity/* so device links and QR codes keep working)
//   * Tabs           — Tonight (live analytics) · Event history · Door devices · Activity log
// The active tab is mirrored into ?tab= so every view is bookmarkable.

const DEFAULT_MAX = 299;

const STATIONS = [
  { href: '/capacity/front-desk', kind: 'LAPTOP', name: 'Front Desk', desc: 'Guest list, QR scan, trial passes', dot: '#ffb84d' },
  { href: '/capacity/front-door', kind: 'JELLY2 · +1', name: 'Front Door', desc: 'Big green check-in button', dot: '#4ade80' },
  { href: '/capacity/exit-door', kind: 'JELLY2 · −1', name: 'Exit Door', desc: 'Big red check-out button', dot: '#f87171' },
  { href: '/capacity/guest-list', kind: 'TABLET', name: 'Guest List', desc: 'Handheld guest check-in', dot: '#60a5fa' },
  { href: '/capacity/security', kind: 'PHONE', name: 'Security', desc: 'Scan IDs, log incidents', dot: '#a3a3a3' },
];

const TABS = [
  { id: 'tonight', label: 'Tonight' },
  { id: 'history', label: 'History' },
  { id: 'devices', label: 'Devices' },
  { id: 'log', label: 'Activity' },
];

const ACTION_LABEL = {
  check_in: 'Check in', check_out: 'Check out', reset: 'Reset to 0', adjust: 'Count set',
  start_session: 'Session started', end_session: 'Session ended',
  blocked_full: 'Blocked · venue full', blocked_empty: 'Blocked · already empty',
};
const SOURCE_LABEL = { front_door: 'Front Door', exit_door: 'Exit Door', admin: 'Admin', system: 'System', unknown: 'Unknown' };

export default function CapacityWorkspace({ initialTab = 'tonight', initialEvent = null }) {
  const { status, session, connected, loading, error, runOp, refresh } = useCapacity({ pollMs: 5000 });
  const [tab, setTab] = useState(TABS.some((t) => t.id === initialTab) ? initialTab : 'tonight');
  const [deviceCount, setDeviceCount] = useState(null);
  const active = status.status !== 'none';

  // Cheap one-off read so the Door devices tab can show its count before it is opened.
  useEffect(() => {
    fetch('/api/capacity/devices', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setDeviceCount((j.devices || []).filter((d) => d.active && !d.revoked_at).length); })
      .catch(() => {});
  }, []);

  function selectTab(id) {
    setTab(id);
    const url = new URL(window.location.href);
    if (id === 'tonight') url.searchParams.delete('tab'); else url.searchParams.set('tab', id);
    if (id !== 'history') url.searchParams.delete('event');
    window.history.replaceState(null, '', url);
  }

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <div>
          <p className={styles.eyebrow}>VENUE OPERATIONS</p>
          <h1 className={styles.title}>Capacity</h1>
        </div>
        <span className={`${styles.pill} ${connected ? styles.pillLive : ''}`} role="status">
          <span className={styles.pillDot} aria-hidden />
          {connected ? 'Live · syncing in real time' : 'Connecting · refreshing every 5s'}
        </span>
      </div>

      {loading && !session ? (
        <div className={`${styles.card} ${styles.live}`} aria-busy="true"><div className={styles.meta}>Loading live count…</div></div>
      ) : active ? (
        <LiveCard status={status} session={session} runOp={runOp} refresh={refresh} error={error} />
      ) : (
        <StartCard runOp={runOp} refresh={refresh} error={error} />
      )}

      <div className={styles.section}>OPEN A STATION</div>
      <nav className={styles.stations} aria-label="Door stations">
        {STATIONS.map((s) => (
          <a key={s.href} href={s.href} target="_blank" rel="noopener noreferrer" className={styles.station}>
            <div className={styles.stationKind}><i style={{ background: s.dot }} aria-hidden />{s.kind}</div>
            <div className={styles.stationName}>{s.name}<span aria-hidden>↗</span></div>
            <div className={styles.stationDesc}>{s.desc}</div>
          </a>
        ))}
      </nav>

      <div className={styles.tabs} role="tablist" aria-label="Capacity views">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabOn : ''}`} onClick={() => selectTab(t.id)}>
            {t.label}
            {t.id === 'devices' && deviceCount != null && <span className={styles.tabCount}>{deviceCount}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'tonight' && <CapacityAnalyticsClient embedded fixedMode="live" />}
        {tab === 'history' && <CapacityAnalyticsClient embedded fixedMode="history" initialEvent={initialEvent} />}
        {tab === 'devices' && <DeviceManager onCountChange={setDeviceCount} />}
        {tab === 'log' && <ActivityLog sessionKey={`${session?.id}:${session?.current_count}`} />}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Live card — count, fill meter, and session controls
// --------------------------------------------------------------------------
function LiveCard({ status, session, runOp, refresh, error }) {
  const [adjustTo, setAdjustTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const pct = Math.round(status.ratio * 100);
  const meterClass = status.status === 'full' ? styles.meterFull : status.status === 'near' ? styles.meterNear : '';

  async function act(fn) {
    setBusy(true); setFlash(null);
    try { setFlash(await fn()); } finally { setBusy(false); refresh(); }
  }

  const adjust = () => act(async () => {
    const t = Number(adjustTo);
    if (adjustTo === '' || !Number.isInteger(t) || t < 0) return { err: 'Enter a whole number of 0 or more.' };
    const res = await runOp('adjust', { target: t, source: 'admin' });
    if (res.ok) setAdjustTo('');
    return res.ok ? { ok: `Count set to ${res.status?.count ?? t}.` } : { err: res.error || 'Could not set the count.' };
  });
  const reset = () => act(async () => {
    const res = await runOp('reset', { source: 'admin' });
    return res.ok ? { ok: 'Count reset to 0.' } : { err: res.error || 'Could not reset.' };
  });
  const end = () => act(async () => {
    const res = await runOp('end');
    return res.ok ? { ok: 'Session ended.' } : { err: res.error || 'Could not end the session.' };
  });

  const message = flash?.err || error ? { cls: styles.flashErr, text: flash?.err || error } : flash?.ok ? { cls: styles.flashOk, text: flash.ok } : null;

  return (
    <section className={`${styles.card} ${styles.live}`} aria-label="Live count">
      <div>
        <div className={styles.liveLabel}>
          {session?.name || 'Tonight'}{session?.started_at ? ` · open since ${time(session.started_at)}` : ''}
        </div>
        <div className={styles.count} aria-live="polite">{status.count}<span>/ {status.max} inside</span></div>
        <div className={`${styles.meter} ${meterClass}`} role="meter" aria-valuemin={0} aria-valuemax={status.max} aria-valuenow={status.count} aria-label="Venue fill">
          <i style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className={styles.meta}>
          <span className={styles.metaStrong}>{status.remaining} spots left</span> · {pct}% full
          {status.status === 'near' && ' · Near capacity'}
          {status.status === 'full' && ' · At capacity, front door is blocked'}
        </div>
      </div>
      <div className={styles.actions}>
        <form className={styles.setRow} onSubmit={(e) => { e.preventDefault(); adjust(); }}>
          <input type="text" inputMode="numeric" pattern="[0-9]*" aria-label="Set count to" className={styles.input}
            value={adjustTo} placeholder={String(status.count)} onChange={(e) => setAdjustTo(e.target.value.replace(/[^0-9]/g, ''))} />
          <button type="submit" className={styles.btn} disabled={busy}>Set count</button>
        </form>
        <ConfirmButton disabled={busy} onConfirm={reset} label="Reset to 0" confirmLabel="Tap again to reset" />
        <ConfirmButton disabled={busy} onConfirm={end} label="End session" confirmLabel="Tap again to end" danger />
        <div className={`${styles.flash} ${message?.cls || ''}`} role="status">{message?.text}</div>
      </div>
    </section>
  );
}

// --------------------------------------------------------------------------
// Start card — shown when no session is active
// --------------------------------------------------------------------------
function StartCard({ runOp, refresh, error }) {
  const [name, setName] = useState('Tonight');
  const [max, setMax] = useState(String(DEFAULT_MAX));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function start(e) {
    e.preventDefault();
    const m = Number(max);
    if (!Number.isInteger(m) || m <= 0) { setErr('Enter a positive max capacity.'); return; }
    setBusy(true); setErr('');
    try {
      const res = await runOp('start', { name: name.trim() || 'Tonight', max_capacity: m });
      if (!res.ok) setErr(res.error || 'Could not start the session.');
    } finally { setBusy(false); refresh(); }
  }

  return (
    <form className={`${styles.card} ${styles.start}`} onSubmit={start} aria-label="Start a session">
      <div>
        <div className={styles.liveLabel}>No active session</div>
        <h2 className={styles.startTitle}>Start counting</h2>
        <p className={styles.startSub}>Door stations stay locked until a session is open. The daily reset also opens one at 9:00 AM Austin time.</p>
        <div className={styles.startFields}>
          <label className={styles.field}>Session name
            <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tonight" />
          </label>
          <label className={styles.field}>Max capacity
            <input className={styles.input} type="text" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/[^0-9]/g, ''))} />
          </label>
        </div>
        {(err || error) && <div className={`${styles.flash} ${styles.flashErr}`} role="status">{err || error}</div>}
      </div>
      <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy}>Start session</button>
    </form>
  );
}

// Two-step inline confirm: first tap arms it for 4s, second tap runs it.
// Replaces browser confirm() dialogs, which are easy to dismiss by accident on a laptop at the door.
function ConfirmButton({ label, confirmLabel, onConfirm, disabled, danger = false }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  function click() {
    if (armed) { clearTimeout(timer.current); setArmed(false); onConfirm(); return; }
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), 4000);
  }
  return (
    <button type="button" disabled={disabled} onClick={click} onBlur={() => setArmed(false)}
      className={`${styles.btn} ${armed ? styles.btnArmed : danger ? styles.btnDanger : ''}`}>
      {armed ? confirmLabel : label}
    </button>
  );
}

// --------------------------------------------------------------------------
// Activity log — latest counter audit rows
// --------------------------------------------------------------------------
function ActivityLog({ sessionKey }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('all');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/capacity/history?limit=100', { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load activity.');
      const json = await res.json();
      setRows(json.events || []); setErr('');
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load, sessionKey]);

  const shown = (rows || []).filter((h) => filter === 'all' ? true
    : filter === 'blocked' ? h.action.startsWith('blocked')
      : filter === 'admin' ? ['reset', 'adjust', 'start_session', 'end_session'].includes(h.action)
        : ['check_in', 'check_out'].includes(h.action));

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <h2 className={styles.panelTitle}>Activity log</h2>
          <p className={styles.panelSub}>Every count change, newest first. Updates when the count moves.</p>
        </div>
        <div className={styles.filters} role="group" aria-label="Filter activity">
          {[['all', 'All'], ['door', 'Door'], ['admin', 'Admin'], ['blocked', 'Blocked']].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} className={filter === id ? styles.filterOn : ''} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      </div>
      {err && <div className={`${styles.flash} ${styles.flashErr}`} role="alert">{err} <button type="button" className={`${styles.btn} ${styles.btnSmall}`} onClick={load}>Retry</button></div>}
      {rows === null && !err ? <div className={styles.empty}>Loading activity…</div>
        : shown.length === 0 ? <div className={styles.empty}>No activity to show.</div> : (
          <div className={styles.rows}>
            {shown.map((h) => (
              <div key={h.id} className={`${styles.row} ${styles.logRow}`}>
                <div className={styles.rowMain}>
                  <span className={h.action.startsWith('blocked') ? styles.rowBlocked : ''} style={{ fontWeight: 600 }}>{ACTION_LABEL[h.action] || h.action}</span>
                  <span className={styles.rowSub}> · {h.device_label || SOURCE_LABEL[h.source] || h.source}</span>
                </div>
                <span className={styles.rowRight}>{h.delta > 0 ? `+${h.delta}` : h.delta} → {h.count_after} · {dateTime(h.created_at)}</span>
              </div>
            ))}
          </div>
        )}
    </section>
  );
}

function time(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }); } catch { return ''; }
}
function dateTime(ts) {
  try { return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }); } catch { return ''; }
}

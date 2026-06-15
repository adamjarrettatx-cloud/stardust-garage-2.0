'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCapacity } from '../useCapacity';

const ACTION_LABEL = {
  check_in: 'Check in', check_out: 'Check out', reset: 'Reset', adjust: 'Adjust',
  start_session: 'Session started', end_session: 'Session ended',
  blocked_full: 'Blocked (full)', blocked_empty: 'Blocked (empty)',
};

export default function AdminCapacityClient() {
  const { status, session, connected, error, runOp, refresh } = useCapacity({ pollMs: 5000 });
  const [name, setName] = useState('Tonight');
  const [max, setMax] = useState(100);
  const [adjustTo, setAdjustTo] = useState('');
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const active = status.status !== 'none';

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/capacity/history?limit=50', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setHistory(json.events || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory, session?.current_count, session?.id]);

  async function withBusy(fn) {
    setBusy(true); setMsg('');
    try { await fn(); } finally { setBusy(false); loadHistory(); refresh(); }
  }

  async function startSession() {
    const m = Number(max);
    if (!Number.isInteger(m) || m <= 0) { setMsg('Enter a positive max capacity.'); return; }
    await withBusy(async () => {
      const res = await runOp('start', { name, max_capacity: m });
      setMsg(res.ok ? 'Session started.' : res.error || 'Failed.');
    });
  }

  async function endSession() {
    if (!confirm('End the current session? The count will stop and the night will be closed.')) return;
    await withBusy(async () => {
      const res = await runOp('end');
      setMsg(res.ok ? 'Session ended.' : res.error || 'Failed.');
    });
  }

  async function resetCount() {
    if (!confirm('Reset the live count to 0? This is logged.')) return;
    await withBusy(async () => {
      const res = await runOp('reset', { source: 'admin' });
      setMsg(res.ok ? 'Count reset to 0.' : res.error || 'Failed.');
    });
  }

  async function adjustCount() {
    const t = Number(adjustTo);
    if (!Number.isInteger(t) || t < 0) { setMsg('Enter a non-negative number to set.'); return; }
    await withBusy(async () => {
      const res = await runOp('adjust', { target: t, source: 'admin' });
      setMsg(res.ok ? `Count set to ${res.status?.count}.` : res.error || 'Failed.');
      if (res.ok) setAdjustTo('');
    });
  }

  return (
    <main className="max-w-[760px] mx-auto px-6 py-12" style={{ color: '#f5f5f5' }}>
      <div className="flex items-center justify-between mb-2">
        <h1 className="text-[30px] font-extrabold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Capacity Setup</h1>
        <span className="flex items-center gap-2 text-[12px]" style={{ color: connected ? '#7CFC9B' : '#8a8a8a' }}>
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: connected ? '#7CFC9B' : '#555' }} aria-hidden />
          {connected ? 'Live' : 'Syncing'}
        </span>
      </div>

      {/* Live status card */}
      <div className="rounded-2xl p-6 mb-6 border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.07)' }}>
        {active ? (
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[12px] tracking-[0.16em] uppercase mb-1" style={{ color: '#8a8a8a' }}>{session?.name}</div>
              <div className="text-[56px] font-extrabold leading-none tabular-nums" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                {status.count}<span className="text-[24px]" style={{ color: '#8a8a8a' }}> / {status.max}</span>
              </div>
            </div>
            <div className="text-right text-[12px]" style={{ color: '#8a8a8a' }}>
              {status.remaining} spots left
            </div>
          </div>
        ) : (
          <div className="text-[16px]" style={{ color: '#8a8a8a' }}>No active session.</div>
        )}
      </div>

      {(msg || error) && (
        <div className="mb-5 text-[13px]" style={{ color: error ? '#ff8a8a' : '#7CFC9B' }}>{error || msg}</div>
      )}

      {/* Start session */}
      {!active && (
        <Section title="Start a session">
          <Field label="Session name">
            <input value={name} onChange={(e) => setName(e.target.value)} className="sdg-input" placeholder="Tonight" />
          </Field>
          <Field label="Max capacity">
            <input type="number" min="1" value={max} onChange={(e) => setMax(e.target.value)} className="sdg-input" />
          </Field>
          <Btn onClick={startSession} disabled={busy} color="#16a34a">Start session</Btn>
        </Section>
      )}

      {/* Manage active session */}
      {active && (
        <Section title="Manage session">
          <Field label="Set count to">
            <div className="flex gap-2">
              <input type="number" min="0" value={adjustTo} onChange={(e) => setAdjustTo(e.target.value)} className="sdg-input" placeholder={String(status.count)} />
              <Btn onClick={adjustCount} disabled={busy} color="#3b82f6">Set</Btn>
            </div>
          </Field>
          <div className="flex flex-wrap gap-3 mt-2">
            <Btn onClick={resetCount} disabled={busy} color="#b45309">Reset to 0</Btn>
            <Btn onClick={endSession} disabled={busy} color="#dc2626">End session</Btn>
          </div>
        </Section>
      )}

      {/* Audit history */}
      <Section title="Recent history">
        {history.length === 0 ? (
          <div className="text-[13px]" style={{ color: '#8a8a8a' }}>No activity yet.</div>
        ) : (
          <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between py-2 text-[13px]">
                <span style={{ color: h.action.startsWith('blocked') ? '#ff8a8a' : '#cfcfcf' }}>
                  {ACTION_LABEL[h.action] || h.action}
                  <span style={{ color: '#666' }}> · {h.source}</span>
                </span>
                <span className="tabular-nums" style={{ color: '#8a8a8a' }}>
                  {h.delta > 0 ? `+${h.delta}` : h.delta} → {h.count_after} · {fmt(h.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <style jsx>{`
        :global(.sdg-input) {
          width: 100%;
          background: #0e0e0e;
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          padding: 12px 14px;
          color: #f5f5f5;
          font-size: 16px;
        }
      `}</style>
    </main>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-2xl p-6 mb-6 border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.07)' }}>
      <h2 className="text-[14px] font-bold tracking-[0.12em] uppercase mb-4" style={{ color: '#cfcfcf' }}>{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-4">
      <span className="block text-[12px] mb-1.5" style={{ color: '#8a8a8a' }}>{label}</span>
      {children}
    </label>
  );
}

function Btn({ onClick, disabled, color, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-5 py-3 rounded-xl font-bold active:scale-[0.98] transition-transform"
      style={{ background: disabled ? '#333' : color, color: disabled ? '#777' : '#fff', fontSize: 15 }}
    >
      {children}
    </button>
  );
}

function fmt(ts) {
  try { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
}

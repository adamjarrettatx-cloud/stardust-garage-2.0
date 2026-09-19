'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// TonightSignInsPanel
//
// Live, chronological list of guests who completed the Trial SDG Pass signup
// form tonight. Feeds from /api/team/trial-pass/today, a team-gated endpoint
// that returns only display-safe fields (name + timestamps) over a rolling
// 12-hour window -- same convention /api/capacity/checkins falls back to.
//
// The door attendant uses this to visually match a walk-up ("Did you sign
// in? What's your name?") to the roster before scanning a ticket or ringing
// up a purchase. Order is oldest -> newest so the person who signed up first
// stays at the top and the newest arrival appears at the bottom, matching
// how a paper sign-in sheet reads.
//
// Polls every 15s and also on window focus so the attendant sees a new
// signup within a few seconds of the guest submitting the form.

const POLL_MS = 15000;

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'America/Chicago',
    });
  } catch {
    return '';
  }
}

export default function TonightSignInsPanel() {
  const [signins, setSignins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const previousIds = useRef(new Set());

  useEffect(() => {
    let cancelled = false;

    async function load(initial) {
      try {
        const res = await fetch('/api/team/trial-pass/today', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || 'Could not load tonight’s sign-ins.');
          return;
        }
        setError(null);
        const list = Array.isArray(json.signins) ? json.signins : [];
        setSignins(list);
        setLastUpdated(new Date());
        // Track ids so subsequent renders can flag the newest arrivals.
        if (initial) {
          previousIds.current = new Set(list.map((row) => row.id));
        }
      } catch {
        if (!cancelled) setError('Network error loading tonight’s sign-ins.');
      } finally {
        if (!cancelled && initial) setLoading(false);
      }
    }

    load(true);
    const interval = setInterval(() => load(false), POLL_MS);
    const onFocus = () => load(false);
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return signins;
    return signins.filter((row) => (row.full_name || '').toLowerCase().includes(q));
  }, [signins, query]);

  const total = signins.length;
  const shown = filtered.length;

  return (
    <section
      className="rounded-2xl border overflow-hidden flex flex-col"
      style={{ background: '#111', borderColor: 'rgba(255,255,255,0.08)', minHeight: 280 }}
    >
      <div
        className="px-5 py-4 border-b flex items-baseline justify-between gap-3 flex-wrap"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div>
          <div className="text-[11px] font-bold tracking-[0.16em] uppercase" style={{ color: '#8a8a8a' }}>
            Tonight’s Sign-Ins
          </div>
          <h2 className="text-[20px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Trial Pass roster
          </h2>
        </div>
        <div className="text-[12px] tabular-nums" style={{ color: '#8a8a8a' }}>
          <span style={{ color: '#7CFC9B' }}>{total}</span> tonight
          {lastUpdated && (
            <>
              {' · '}updated {formatTime(lastUpdated.toISOString())}
            </>
          )}
        </div>
      </div>

      <div className="px-5 pt-4 pb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="fd-input"
          placeholder="Search name…"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search tonight’s sign-ins"
        />
      </div>

      {error && (
        <div
          className="mx-5 mt-1 mb-2 px-3 py-2 rounded-lg text-[13px] font-semibold"
          style={{ color: '#ff8a8a', background: 'rgba(255,138,138,0.08)' }}
          aria-live="polite"
        >
          {error}
        </div>
      )}

      <div className="flex-1 px-5 pb-5 pt-1 overflow-y-auto">
        {loading ? (
          <div className="text-[14px] py-10 text-center" style={{ color: '#8a8a8a' }}>
            Loading…
          </div>
        ) : total === 0 ? (
          <div className="text-[14px] py-10 text-center" style={{ color: '#8a8a8a' }}>
            No sign-ins yet tonight. Guests should scan the QR code at the door.
          </div>
        ) : shown === 0 ? (
          <div className="text-[14px] py-10 text-center" style={{ color: '#8a8a8a' }}>
            Nobody matches that name. Ask the guest to spell it, or confirm they submitted the form.
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((row, index) => (
              <li
                key={row.id}
                className="flex items-center gap-3 px-3 py-2 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                <span
                  className="text-[12px] font-bold tabular-nums shrink-0"
                  style={{ color: '#8a8a8a', minWidth: 26, textAlign: 'right' }}
                >
                  {index + 1}
                </span>
                <span
                  className="flex-1 text-[15px] font-semibold truncate"
                  style={{ color: '#f5f5f5' }}
                >
                  {row.full_name}
                </span>
                <span
                  className="text-[12px] tabular-nums shrink-0"
                  style={{ color: '#8a8a8a' }}
                >
                  {formatTime(row.issued_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
//
// Each row has a check box the attendant clicks the moment they let the
// guest in. That click bumps the venue capacity by one -- same primitive
// (bumpCapacityFor) the Guest List uses. The set of admitted ids is kept
// in localStorage keyed by tonight's calendar day so a laptop refresh mid
// shift does not re-arm the checkboxes and double-bump the count.

const POLL_MS = 15000;

// Chicago-local calendar day string (YYYY-MM-DD). Used as the localStorage
// namespace so tomorrow's shift starts with a clean set of checkboxes.
function chicagoDayKey() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    return parts; // en-CA yields YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const STORAGE_PREFIX = 'sdg.front-desk.trial-roster-checked-in.';

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

export default function TonightSignInsPanel({ onCheckIn }) {
  const [signins, setSignins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [checkedIn, setCheckedIn] = useState(() => new Set());
  const [busyId, setBusyId] = useState(null);
  const [rowNote, setRowNote] = useState(null); // { id, message, tone }
  const previousIds = useRef(new Set());
  const storageKey = useMemo(() => STORAGE_PREFIX + chicagoDayKey(), []);

  // Rehydrate the checked-in set for tonight so a laptop refresh does not
  // re-arm every checkbox and re-bump the count.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setCheckedIn(new Set(parsed));
    } catch {
      // Corrupted entry -- start fresh rather than crash the shift.
    }
  }, [storageKey]);

  // Persist every mutation so a refresh in the middle of a rush picks up
  // exactly where the attendant left off.
  const persistCheckedIn = useCallback((next) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
    } catch {
      // Storage quota / private mode -- non-fatal.
    }
  }, [storageKey]);

  const handleToggle = useCallback(async (row) => {
    if (checkedIn.has(row.id) || busyId) return;
    setBusyId(row.id);
    setRowNote(null);

    // Optimistic check so double-clicks don't double-fire.
    const next = new Set(checkedIn);
    next.add(row.id);
    setCheckedIn(next);
    persistCheckedIn(next);

    let warning = null;
    if (typeof onCheckIn === 'function') {
      try {
        warning = await onCheckIn(row);
      } catch {
        warning = 'Check-in recorded, but the capacity count could not be bumped.';
      }
    }

    setBusyId(null);
    if (warning) {
      setRowNote({ id: row.id, message: warning, tone: 'warn' });
    } else {
      setRowNote({ id: row.id, message: `${row.full_name} checked in.`, tone: 'ok' });
    }
  }, [checkedIn, busyId, onCheckIn, persistCheckedIn]);

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
  const inCount = useMemo(
    () => signins.reduce((acc, r) => acc + (checkedIn.has(r.id) ? 1 : 0), 0),
    [signins, checkedIn],
  );

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
          <span style={{ color: '#7CFC9B' }}>{inCount} in</span>
          {' · '}{total - inCount} to come
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

      {(error || rowNote) && (
        <div
          className="mx-5 mt-1 mb-2 px-3 py-2 rounded-lg text-[13px] font-semibold"
          style={{
            color: error || rowNote?.tone === 'warn' ? '#ff8a8a' : '#7CFC9B',
            background: error || rowNote?.tone === 'warn'
              ? 'rgba(255,138,138,0.08)'
              : 'rgba(124,252,155,0.08)',
          }}
          aria-live="polite"
        >
          {error || rowNote?.message}
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
            {filtered.map((row, index) => {
              const isIn = checkedIn.has(row.id);
              const isBusy = busyId === row.id;
              return (
                <li
                  key={row.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl"
                  style={{
                    background: isIn ? 'rgba(124,252,155,0.06)' : 'rgba(255,255,255,0.03)',
                    opacity: isIn ? 0.7 : 1,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleToggle(row)}
                    disabled={isIn || isBusy}
                    aria-label={isIn ? `${row.full_name} checked in` : `Check in ${row.full_name}`}
                    aria-pressed={isIn}
                    className="shrink-0 flex items-center justify-center rounded-lg transition-colors"
                    style={{
                      width: 32,
                      height: 32,
                      background: isIn ? '#7CFC9B' : 'transparent',
                      border: isIn
                        ? '1px solid #7CFC9B'
                        : '1px solid rgba(255,255,255,0.25)',
                      cursor: isIn || isBusy ? 'default' : 'pointer',
                    }}
                  >
                    {isIn ? (
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path
                          d="M4 10.5 L8 14.5 L16 6.5"
                          stroke="#0a0a0a"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : isBusy ? (
                      <span
                        className="inline-block rounded-full"
                        style={{
                          width: 12,
                          height: 12,
                          border: '2px solid rgba(255,255,255,0.35)',
                          borderTopColor: '#f5f5f5',
                          animation: 'fd-spin 0.7s linear infinite',
                        }}
                      />
                    ) : null}
                  </button>
                  <span
                    className="text-[12px] font-bold tabular-nums shrink-0"
                    style={{ color: '#8a8a8a', minWidth: 22, textAlign: 'right' }}
                  >
                    {index + 1}
                  </span>
                  <span
                    className="flex-1 text-[15px] font-semibold truncate"
                    style={{
                      color: isIn ? '#8a8a8a' : '#f5f5f5',
                      textDecoration: isIn ? 'line-through' : 'none',
                    }}
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
              );
            })}
          </ul>
        )}
      </div>
      <style jsx>{`
        @keyframes fd-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </section>
  );
}

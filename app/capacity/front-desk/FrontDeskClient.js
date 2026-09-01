'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterRoster, summarizeRoster } from '@/lib/guestlist-checkin';
import { useCapacity } from '../useCapacity';
import CheckInSheet from '../guest-list/CheckInSheet';
import ManualTrialPassForm from '@/app/team/trial-pass/manual/ManualTrialPassForm';
import AuthenticatedThemeProvider from '@/app/components/AuthenticatedThemeProvider';

// /capacity/front-desk client
//
// Laptop-shaped composition of three existing surfaces:
//   * top strip     — live capacity from useCapacity() (team mode, no token)
//   * left column   — event picker + name search + check-in list, opens the
//                     existing CheckInSheet for the confirm/pick/intake flow
//   * right column  — the same manual trial pass form used at /team/trial-pass/manual
//
// The check-in itself STILL goes through /api/capacity/guestlist/operation,
// exactly like the tablet page, so audit rows and RLS behaviour are identical.
// The one extra thing this page does is fire a capacity check_in after a
// successful guest-list check_in — Adam wants the venue count to reflect what
// happened at the door automatically instead of waiting for someone to tap the
// Jelly2 phone. The capacity write is best-effort: if there's no active
// session, or the count is already at max, the guest is still on the list but
// we surface a warning so the manager knows to reconcile.

const ROSTER_POLL_MS = 20000;
const MAX_ROWS = 200; // laptop can show more than the tablet's 60

export default function FrontDeskClient({ staffLabel, staffEmail }) {
  // ---- Live capacity (team mode: no device token) --------------------------
  const capacity = useCapacity({ pollMs: 4000 });

  // ---- Guest list roster state --------------------------------------------
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [rosterError, setRosterError] = useState(null);
  const [note, setNote] = useState('');
  const [activeEntry, setActiveEntry] = useState(null);
  const [noShowId, setNoShowId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const searchRef = useRef(null);

  // Load event picker once. defaultEventId is tonight's event when there is
  // one, so the common case is zero taps.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/capacity/guestlist/events', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setRosterError(json.error || 'Could not load events.');
          setLoadingRoster(false);
          return;
        }
        setEvents(json.events || []);
        setEventId(json.defaultEventId || '');
        if (!json.defaultEventId) setLoadingRoster(false);
      } catch {
        if (!cancelled) {
          setRosterError('Network error loading events.');
          setLoadingRoster(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadRoster = useCallback(async (id, { quiet = false } = {}) => {
    if (!id) return;
    if (!quiet) setLoadingRoster(true);
    try {
      const res = await fetch(`/api/capacity/guestlist/entries?eventId=${encodeURIComponent(id)}`, {
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRosterError(json.error || 'Could not load the guest list.');
        return;
      }
      setEntries(json.entries || []);
      setRosterError(null);
    } catch {
      if (!quiet) setRosterError('Network error loading the guest list.');
    } finally {
      if (!quiet) setLoadingRoster(false);
    }
  }, []);

  useEffect(() => { loadRoster(eventId); }, [eventId, loadRoster]);

  // Pause the poll while a check-in sheet is open so rows can't shift under it.
  useEffect(() => {
    if (!eventId || activeEntry) return undefined;
    const id = setInterval(() => loadRoster(eventId, { quiet: true }), ROSTER_POLL_MS);
    return () => clearInterval(id);
  }, [eventId, activeEntry, loadRoster]);

  useEffect(() => {
    if (!noShowId) return undefined;
    const id = setTimeout(() => setNoShowId(null), 5000);
    return () => clearTimeout(id);
  }, [noShowId]);

  const summary = useMemo(() => summarizeRoster(entries), [entries]);
  const matches = useMemo(() => filterRoster(entries, query), [entries, query]);
  const visible = matches.slice(0, MAX_ROWS);
  const selectedEvent = events.find((e) => e.id === eventId) || null;

  // ---- Auto-bump venue capacity after a guest-list check-in ---------------
  //
  // Called only after the guestlist route returned ok. Best-effort: if the
  // capacity write fails (no active session, at max, network) we do NOT undo
  // the guest-list check-in — the guest is standing at the door, they're
  // already in. Instead we surface the reason so the on-shift manager knows to
  // reconcile.
  //
  // source: capacity_events.source has a CHECK constraint that only allows
  // front_door / exit_door / admin / system / unknown. Using 'front_door'
  // groups the laptop tap with the Jelly2 phone in the audit log, which is
  // fine for now; the note field carries the distinction as 'front_desk
  // laptop' when we need to slice it later. If we ever add 'front_desk' to
  // the CHECK constraint, swap here and in lib/capacity-utils.js VALID_SOURCES.
  const bumpCapacity = useCallback(async () => {
    try {
      const res = await fetch('/api/capacity/operation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'check_in',
          source: 'front_door',
          note: 'front_desk laptop (guest-list check-in)',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.code === 'full') return ' At capacity — count not bumped.';
        if (json.code === 'no_session') return ' No active capacity session — count not bumped.';
        return ' Count not bumped: ' + (json.error || 'try again from /capacity/admin');
      }
      // Force the on-screen count to reflect the new value immediately.
      capacity.refresh?.();
      return '';
    } catch {
      return ' Count not bumped (network).';
    }
  }, [capacity]);

  function applyUpdate(updated, message) {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? { ...e, ...updated } : e)));
    setNote(message);
    setQuery('');
    searchRef.current?.focus();
  }

  async function markNoShow(entry) {
    if (noShowId !== entry.id) {
      setNoShowId(entry.id);
      return;
    }
    setNoShowId(null);
    setBusyId(entry.id);
    setNote('');
    try {
      const res = await fetch('/api/capacity/guestlist/operation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'no_show', entryId: entry.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRosterError(json.error || 'Could not mark that no-show.');
        if (json.code === 'already_resolved') loadRoster(eventId, { quiet: true });
        return;
      }
      setRosterError(null);
      applyUpdate(json.entry, `${entry.guest_name} marked no-show.`);
    } catch {
      setRosterError('Network error. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  // ---- Capacity strip renders ---------------------------------------------
  const capStatus = capacity.status?.status || 'none';
  const capPillColor = {
    none: '#8a8a8a',
    empty: '#8a8a8a',
    open: '#7CFC9B',
    near: '#ffb84d',
    full: '#ff5c5c',
  }[capStatus] || '#8a8a8a';
  const capPillLabel = {
    none: 'No session',
    empty: 'Empty',
    open: 'Open',
    near: 'Near capacity',
    full: 'AT CAPACITY',
  }[capStatus] || 'No session';

  return (
    <main
      className="min-h-[100dvh] flex flex-col"
      style={{ background: '#0a0a0a', color: '#f5f5f5' }}
    >
      {/* ---------- Sticky top strip: live capacity + staff badge ---------- */}
      <header
        className="sticky top-0 z-20 border-b"
        style={{ background: '#0a0a0a', borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center gap-6 flex-wrap">
          <div className="flex items-center gap-3">
            <div
              className="text-[11px] font-bold tracking-[0.16em] uppercase"
              style={{ color: '#8a8a8a' }}
            >
              Front Desk
            </div>
            <div className="flex items-center gap-1.5" style={{ color: capacity.connected ? '#7CFC9B' : '#8a8a8a' }}>
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: capacity.connected ? '#7CFC9B' : '#555' }}
                aria-hidden
              />
              <span className="text-[11px] font-semibold tracking-wide">
                {capacity.connected ? 'Live' : 'Syncing'}
              </span>
            </div>
          </div>

          {/* Capacity readout — big enough to read from a distance, small enough
              to stay out of the way. */}
          <div className="flex items-baseline gap-2">
            {capStatus === 'none' ? (
              <span className="text-[16px] font-bold" style={{ color: '#8a8a8a' }}>
                No active session
              </span>
            ) : (
              <>
                <span
                  className="text-[32px] font-extrabold leading-none tabular-nums"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: capPillColor }}
                  aria-live="polite"
                >
                  {capacity.status?.count ?? 0}
                </span>
                <span className="text-[14px] font-semibold" style={{ color: '#8a8a8a' }}>
                  of {capacity.status?.max ?? '—'}
                </span>
                <span
                  className="ml-2 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.1em] uppercase"
                  style={{ background: 'rgba(255,255,255,0.06)', color: capPillColor }}
                >
                  {capPillLabel}
                </span>
              </>
            )}
          </div>

          <div className="flex-1" />
          <div className="text-right">
            <div className="text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: '#8a8a8a' }}>
              On shift
            </div>
            <div className="text-[13px] font-semibold truncate" style={{ maxWidth: 240 }}>
              {staffLabel}
            </div>
          </div>
        </div>
      </header>

      {/* ---------- Body: two columns on wide screens, stacked on narrow ---- */}
      <div className="max-w-[1400px] w-full mx-auto px-6 py-6 grid gap-6 grid-cols-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* ============== LEFT: Guest list check-in =========================== */}
        <section
          className="rounded-2xl border overflow-hidden flex flex-col"
          style={{ background: '#111', borderColor: 'rgba(255,255,255,0.08)', minHeight: 520 }}
        >
          <div
            className="px-5 py-4 border-b flex items-baseline justify-between gap-3 flex-wrap"
            style={{ borderColor: 'rgba(255,255,255,0.06)' }}
          >
            <div>
              <div className="text-[11px] font-bold tracking-[0.16em] uppercase" style={{ color: '#8a8a8a' }}>
                Guest List
              </div>
              <h2 className="text-[20px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                {selectedEvent?.title || 'Check in'}
              </h2>
            </div>
            <div className="text-[12px] tabular-nums" style={{ color: '#8a8a8a' }}>
              <span style={{ color: '#7CFC9B' }}>{summary.checked_in} in</span>
              {' · '}{summary.pending} to come
              {summary.no_show > 0 && (
                <>{' · '}<span style={{ color: '#ff8a8a' }}>{summary.no_show} no-show</span></>
              )}
            </div>
          </div>

          <div className="px-5 pt-4 pb-2 flex flex-col gap-3">
            {events.length > 1 && (
              <select
                value={eventId}
                onChange={(e) => { setEventId(e.target.value); setQuery(''); setNote(''); }}
                className="fd-input"
                aria-label="Event"
              >
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {formatEventDate(e.event_date)} · {e.title} ({e.entry_count})
                  </option>
                ))}
              </select>
            )}

            <div className="flex gap-2">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="fd-input flex-1"
                placeholder="Search guest name…"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-label="Search guest name"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); searchRef.current?.focus(); }}
                  className="px-4 rounded-xl font-bold shrink-0"
                  style={{ background: '#1e1e1e', color: '#cfcfcf' }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {(rosterError || note) && (
            <div
              className="mx-5 mt-1 mb-2 px-3 py-2 rounded-lg text-[13px] font-semibold"
              style={{
                color: rosterError ? '#ff8a8a' : '#7CFC9B',
                background: rosterError ? 'rgba(255,138,138,0.08)' : 'rgba(124,252,155,0.08)',
              }}
              aria-live="polite"
            >
              {rosterError || note}
            </div>
          )}

          <div className="flex-1 px-5 pb-5 pt-1 overflow-y-auto">
            {loadingRoster ? (
              <div className="text-[14px] py-10 text-center" style={{ color: '#8a8a8a' }}>
                Loading…
              </div>
            ) : !eventId ? (
              <EmptyState
                title="No guest lists yet"
                body="No event from tonight onward has a guest list allocation. An admin sets those up on the event page."
              />
            ) : entries.length === 0 ? (
              <EmptyState
                title="Nobody on the list"
                body={`No partner has added names to ${selectedEvent?.title || 'this event'} yet.`}
              />
            ) : visible.length === 0 ? (
              <EmptyState
                title="No match"
                body="Nobody on tonight's list matches that name. Check the spelling, or the guest may be on a different night."
              />
            ) : (
              <ul className="space-y-2">
                {visible.map((entry) => (
                  <EntryRow
                    key={entry.id}
                    entry={entry}
                    busy={busyId === entry.id}
                    confirmingNoShow={noShowId === entry.id}
                    onCheckIn={() => { setNote(''); setActiveEntry(entry); }}
                    onNoShow={() => markNoShow(entry)}
                  />
                ))}
                {matches.length > visible.length && (
                  <li className="text-[12px] py-2 text-center" style={{ color: '#8a8a8a' }}>
                    +{matches.length - visible.length} more — keep typing to narrow it down.
                  </li>
                )}
              </ul>
            )}
          </div>
        </section>

        {/* ============== RIGHT: Issue trial pass ============================= */}
        {/* ManualTrialPassForm expects the --auth-* CSS variables set up by
            AuthenticatedThemeProvider; wrap the panel in the provider (team
            scope, dark) so we don't have to re-declare its theme here. */}
        <AuthenticatedThemeProvider scope="team">
          <section
            className="rounded-2xl border p-5"
            style={{ background: '#111', borderColor: 'rgba(255,255,255,0.08)' }}
          >
            <div className="mb-4">
              <div className="text-[11px] font-bold tracking-[0.16em] uppercase" style={{ color: '#8a8a8a' }}>
                Trial Pass · Front-desk override
              </div>
              <h2 className="text-[20px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                Issue a Trial SDG Pass
              </h2>
              <p className="text-[13px] mt-1" style={{ color: '#8a8a8a' }}>
                For guests who can&apos;t receive the SMS code — dead phone, foreign number,
                landline. Creates a pass without the code step and records that you did it.
              </p>
            </div>
            <ManualTrialPassForm createdByEmail={staffEmail} />
          </section>
        </AuthenticatedThemeProvider>
      </div>

      {/* ---------- Check-in sheet (modal from CheckInSheet) ----------------- */}
      {activeEntry && (
        <CheckInSheet
          entry={activeEntry}
          onClose={() => setActiveEntry(null)}
          onCheckedIn={async (updated, message) => {
            setActiveEntry(null);
            setRosterError(null);
            const suffix = await bumpCapacity();
            applyUpdate(updated, `${message}${suffix}`);
          }}
          onConflict={(message) => {
            setActiveEntry(null);
            setRosterError(message);
            loadRoster(eventId, { quiet: true });
          }}
        />
      )}

      <style jsx>{`
        :global(.fd-input) {
          background: #0e0e0e;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          padding: 12px 14px;
          color: #f5f5f5;
          font-size: 15px;
          width: 100%;
        }
        :global(.fd-input:focus) {
          outline: none;
          border-color: rgba(124, 252, 155, 0.5);
        }
      `}</style>
    </main>
  );
}

const STATUS_META = {
  pending: { label: 'On list', color: '#cfcfcf', bg: 'rgba(255,255,255,0.07)' },
  checked_in: { label: 'Checked in', color: '#7CFC9B', bg: 'rgba(124,252,155,0.12)' },
  no_show: { label: 'No show', color: '#ff8a8a', bg: 'rgba(255,138,138,0.12)' },
};

function EntryRow({ entry, busy, confirmingNoShow, onCheckIn, onNoShow }) {
  const pending = entry.status === 'pending';
  const meta = STATUS_META[entry.status] || STATUS_META.pending;
  const isDiscount = entry.comp_type === 'discount';

  return (
    <li className="flex gap-2 items-stretch">
      <button
        type="button"
        onClick={pending ? onCheckIn : undefined}
        disabled={!pending || busy}
        className="flex-1 min-w-0 text-left rounded-xl px-4 py-3 border transition-transform active:scale-[0.995]"
        style={{
          background: '#141414',
          borderColor: pending ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
          opacity: pending ? 1 : 0.65,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div
              className="text-[17px] font-bold leading-tight truncate"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {entry.guest_name}
            </div>
            <div className="text-[12px] mt-0.5 truncate" style={{ color: '#8a8a8a' }}>
              {entry.partner_name}
              {entry.status === 'checked_in' && entry.checked_in_at && ` · in at ${formatTime(entry.checked_in_at)}`}
            </div>
          </div>
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.1em] uppercase"
            style={{ background: meta.bg, color: meta.color }}
          >
            {meta.label}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <span
            className="rounded-md px-2 py-1 text-[11px] font-bold tracking-[0.08em] uppercase"
            style={
              isDiscount
                ? { background: 'rgba(255,184,77,0.15)', color: '#ffb84d' }
                : { background: 'rgba(124,252,155,0.12)', color: '#7CFC9B' }
            }
          >
            {isDiscount ? 'Discount' : 'Free'}
          </span>
          {isDiscount && (
            <span className="text-[13px] font-semibold" style={{ color: '#ffb84d' }}>
              {entry.discount_detail || 'No discount detail — ask a manager'}
            </span>
          )}
        </div>
      </button>

      {pending && (
        <button
          type="button"
          onClick={onNoShow}
          disabled={busy}
          className="w-[92px] shrink-0 rounded-xl text-[12px] font-bold leading-tight transition-transform active:scale-[0.97]"
          style={{
            background: confirmingNoShow ? '#7f1d1d' : '#181818',
            color: confirmingNoShow ? '#fff' : '#8a8a8a',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {confirmingNoShow ? 'Confirm no-show' : 'No show'}
        </button>
      )}
    </li>
  );
}

function EmptyState({ title, body }) {
  return (
    <div className="text-center py-10 px-4">
      <div
        className="text-[18px] font-bold mb-1"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        {title}
      </div>
      <p className="text-[14px] max-w-[26rem] mx-auto" style={{ color: '#8a8a8a' }}>
        {body}
      </p>
    </div>
  );
}

function formatEventDate(date) {
  try {
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return date;
  }
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterRoster, summarizeRoster } from '@/lib/guestlist-checkin';
import CheckInSheet from './CheckInSheet';

// The roster refreshes on a timer rather than a realtime channel: a second
// tablet (or an admin adding a late name) shows up within a few seconds, and
// unlike the capacity counter there is no number on screen that has to be
// instantly correct.
const ROSTER_POLL_MS = 20000;

// Cap on rendered rows. The filter is ordered most-likely-first, so anything
// past this is noise on a door tablet — and rendering 400 rows on every
// keystroke is what makes a search feel slow.
const MAX_ROWS = 60;

export default function GuestListDoorClient() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [note, setNote] = useState('');
  const [activeEntry, setActiveEntry] = useState(null);
  const [noShowId, setNoShowId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const searchRef = useRef(null);

  // Load the event picker once. defaultEventId is tonight's event when there is
  // one (see pickDefaultEventId), so the common case is zero taps to get going.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/capacity/guestlist/events', { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || 'Could not load events.');
          setLoading(false);
          return;
        }
        setEvents(json.events || []);
        setEventId(json.defaultEventId || '');
        if (!json.defaultEventId) setLoading(false);
      } catch {
        if (!cancelled) {
          setError('Network error loading events.');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const loadRoster = useCallback(async (id, { quiet = false } = {}) => {
    if (!id) return;
    if (!quiet) setLoading(true);
    try {
      const res = await fetch(`/api/capacity/guestlist/entries?eventId=${encodeURIComponent(id)}`, {
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Could not load the guest list.');
        return;
      }
      setEntries(json.entries || []);
      setError(null);
    } catch {
      // Network blip — keep the list we already have; the poll will retry.
      if (!quiet) setError('Network error loading the guest list.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { loadRoster(eventId); }, [eventId, loadRoster]);

  // Pause the poll while a check-in is open so the list cannot move under the
  // sheet mid-flow.
  useEffect(() => {
    if (!eventId || activeEntry) return undefined;
    const id = setInterval(() => loadRoster(eventId, { quiet: true }), ROSTER_POLL_MS);
    return () => clearInterval(id);
  }, [eventId, activeEntry, loadRoster]);

  // A pending "Confirm no-show?" reverts on its own — a mis-tap should not stay
  // armed while staff move on to the next guest.
  useEffect(() => {
    if (!noShowId) return undefined;
    const id = setTimeout(() => setNoShowId(null), 5000);
    return () => clearTimeout(id);
  }, [noShowId]);

  const summary = useMemo(() => summarizeRoster(entries), [entries]);
  const matches = useMemo(() => filterRoster(entries, query), [entries, query]);
  const visible = matches.slice(0, MAX_ROWS);

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
        setError(json.error || 'Could not mark that no-show.');
        if (json.code === 'already_resolved') loadRoster(eventId, { quiet: true });
        return;
      }
      setError(null);
      applyUpdate(json.entry, `${entry.guest_name} marked no-show.`);
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  const selectedEvent = events.find((e) => e.id === eventId) || null;

  return (
    <main
      className="door-list min-h-[100dvh] flex flex-col"
      style={{ background: '#0a0a0a', color: '#f5f5f5', touchAction: 'manipulation' }}
    >
      <header
        className="sticky top-0 z-10 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 border-b"
        style={{ background: '#0a0a0a', borderColor: 'rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <div className="text-[11px] font-bold tracking-[0.16em] uppercase" style={{ color: '#8a8a8a' }}>
            Guest List · Door
          </div>
          <div className="text-[12px] tabular-nums shrink-0" style={{ color: '#8a8a8a' }}>
            <span style={{ color: '#7CFC9B' }}>{summary.checked_in} in</span>
            {' · '}{summary.pending} to come
            {summary.no_show > 0 && <>{' · '}<span style={{ color: '#ff8a8a' }}>{summary.no_show} no-show</span></>}
          </div>
        </div>

        {events.length > 1 && (
          <select
            value={eventId}
            onChange={(e) => { setEventId(e.target.value); setQuery(''); setNote(''); }}
            className="door-select mb-2"
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
            className="door-input flex-1"
            placeholder="Search guest name…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
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
      </header>

      {(error || note) && (
        <div
          className="px-4 py-2 text-[14px] font-semibold"
          style={{ color: error ? '#ff8a8a' : '#7CFC9B', background: error ? '#2a0a0a' : '#0f1f13' }}
          aria-live="polite"
        >
          {error || note}
        </div>
      )}

      <div className="flex-1 px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {loading ? (
          <div className="text-[14px] py-8 text-center" style={{ color: '#8a8a8a' }}>Loading…</div>
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

      {activeEntry && (
        <CheckInSheet
          entry={activeEntry}
          onClose={() => setActiveEntry(null)}
          onCheckedIn={(updated, message) => {
            setActiveEntry(null);
            setError(null);
            applyUpdate(updated, message);
          }}
          onConflict={(message) => {
            setActiveEntry(null);
            setError(message);
            loadRoster(eventId, { quiet: true });
          }}
        />
      )}

      <style jsx>{`
        :global(.door-list .door-input),
        :global(.door-list .door-select) {
          width: 100%;
          background: #141414;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 14px;
          padding: 14px 16px;
          color: #f5f5f5;
          /* 16px minimum keeps mobile Safari from zooming the whole kiosk on focus. */
          font-size: 17px;
        }
        :global(.door-list .door-input:focus),
        :global(.door-list .door-select:focus) {
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
        className="flex-1 min-w-0 text-left rounded-2xl px-4 py-3 border active:scale-[0.99] transition-transform"
        style={{
          background: '#141414',
          borderColor: pending ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
          opacity: pending ? 1 : 0.65,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[19px] font-bold leading-tight truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
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
          {/* The discount is applied by hand in the POS, so this text is the
              whole instruction — it belongs on the row, not one tap deeper. */}
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
          className="w-[86px] shrink-0 rounded-2xl text-[12px] font-bold leading-tight active:scale-[0.97] transition-transform"
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
      <div className="text-[18px] font-bold mb-1" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{title}</div>
      <p className="text-[14px] max-w-[24rem] mx-auto" style={{ color: '#8a8a8a' }}>{body}</p>
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

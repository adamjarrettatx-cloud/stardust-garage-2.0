'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterRoster, summarizeRoster } from '@/lib/guestlist-checkin';
import { useCapacity } from '../useCapacity';
import CheckInSheet from '../guest-list/CheckInSheet';
import ManualTrialPassForm from '@/app/team/trial-pass/manual/ManualTrialPassForm';
import AuthenticatedThemeProvider from '@/app/components/AuthenticatedThemeProvider';
import UnifiedDoorScanner from '../components/UnifiedDoorScanner';
import { pushRecentActivity, formatActivityTime } from '@/lib/scan/recent-activity';

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

  // ---- Door session (governs which event's tickets are scannable) --------
  //
  // Ticket scans MUST be tied to an active door_sessions row — the /api/tickets
  // /scan endpoint requires event_id, and every scan (member/trial/ticket)
  // stamps door_session_id on its audit row so we can reconstruct "who was
  // running the door for this event." This is the exact same contract the
  // standalone /scan page uses; we're just presenting the controls next to
  // the other front-desk surfaces instead of on their own page.
  //
  // Starting a session ALSO sets the guest-list dropdown to the same event.
  // The two are conceptually distinct (roster vs door-log) but in practice
  // the person at the front desk is always working one event at a time.
  const [activeSession, setActiveSession] = useState(null); // full session row w/ .event
  const [sessionBusy, setSessionBusy] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [startPickerOpen, setStartPickerOpen] = useState(false);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);

  // The Start Event picker shows EVERY upcoming event (include_all=1) — not
  // just the guest-list ones — so a manager can open a door for an early
  // check-in or a testing pass. Loaded lazily when the picker opens so we
  // don't fire an extra request on every page load.
  const [pickerEvents, setPickerEvents] = useState([]);
  const [pickerEventsLoading, setPickerEventsLoading] = useState(false);
  const [pickerEventsError, setPickerEventsError] = useState('');

  // Load whatever session is currently open. Runs once at mount and again
  // after every start/end so the bar reflects reality without a full reload.
  const refreshActiveSession = useCallback(async () => {
    try {
      const res = await fetch('/api/door-session/active', { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setActiveSession(json.session || null);
        if (json.session?.event_id) {
          // Sync the guest-list dropdown to the session's event so the manager
          // is not looking at Wednesday's roster while scanning Thursday's
          // tickets. Safe to call setEventId with the same value — React will
          // no-op if it hasn't changed.
          setEventId(json.session.event_id);
        }
      }
    } catch {
      // Non-fatal — the bar will just show "no active event."
    }
  }, []);

  useEffect(() => { refreshActiveSession(); }, [refreshActiveSession]);

  const startDoorSession = useCallback(async (targetEventId) => {
    if (!targetEventId) return;
    setSessionBusy(true);
    setSessionError('');
    try {
      const res = await fetch('/api/door-session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: targetEventId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSessionError(json.error || 'Could not start the event.');
        return;
      }
      setStartPickerOpen(false);
      await refreshActiveSession();
    } catch {
      setSessionError('Network error starting the event.');
    } finally {
      setSessionBusy(false);
    }
  }, [refreshActiveSession]);

  const endDoorSession = useCallback(async () => {
    setSessionBusy(true);
    setSessionError('');
    try {
      const res = await fetch('/api/door-session/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSessionError(json.error || 'Could not end the event.');
        return;
      }
      setConfirmEndOpen(false);
      await refreshActiveSession();
    } catch {
      setSessionError('Network error ending the event.');
    } finally {
      setSessionBusy(false);
    }
  }, [refreshActiveSession]);

  const activeEvent = activeSession?.event || null;
  const doorSessionId = activeSession?.id || null;

  // ---- Recent activity (last 5, client-only ring buffer) ------------------
  //
  // Kept in memory only. Refreshing the laptop clears it — that's fine, it
  // exists so the manager can glance and see "we let the last five people in"
  // without opening the admin audit page. Guest-list check-ins, trial-pass
  // scans, and member-id verifies all funnel through logActivity() so the
  // panel renders one unified stream sorted newest-first.
  const [recentActivity, setRecentActivity] = useState([]);
  // Separate, longer-lived buffer for the chronological check-in list under
  // the trial-pass panel. Only admitted entries land here; denials + rejects
  // stay in recentActivity (the top-right "Last 5 admits" strip). 50 rows
  // is enough to cover a full night without pinning render cost.
  const [checkedInHistory, setCheckedInHistory] = useState([]);
  const logActivity = useCallback((entry) => {
    setRecentActivity((prev) => pushRecentActivity(prev, entry));
    if (entry?.result === 'admitted') {
      setCheckedInHistory((prev) => pushRecentActivity(prev, entry, 50));
    }
  }, []);

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
  // bumpCapacityFor(note) — parameterised so a scanned admit and a guest-list
  // check-in write different audit notes against the same source. Returns
  // null on success, or a human-readable warning string.
  const bumpCapacityFor = useCallback(async (note) => {
    try {
      const res = await fetch('/api/capacity/operation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'check_in',
          source: 'front_door',
          note,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.code === 'full') return 'At capacity — count not bumped.';
        if (json.code === 'no_session') return 'No active capacity session — count not bumped.';
        return 'Count not bumped: ' + (json.error || 'try again from /capacity/admin');
      }
      capacity.refresh?.();
      return null;
    } catch {
      return 'Count not bumped (network).';
    }
  }, [capacity]);

  // Guest-list wrapper: the applyUpdate() consumer expects a leading space
  // that gets concatenated onto the status message. Preserve that shape.
  const bumpCapacity = useCallback(async () => {
    const warning = await bumpCapacityFor('front_desk laptop (guest-list check-in)');
    return warning ? ` ${warning}` : '';
  }, [bumpCapacityFor]);

  // Scanner path: called AFTER the scanner has committed the admit. Returned
  // string (or null) is rendered on the scanner's result card.
  const getScannerBumpWarning = useCallback(async ({ source }) => {
    const note = source === 'member_id'
      ? 'front_desk (member scan)'
      : 'front_desk (trial-pass scan)';
    return bumpCapacityFor(note);
  }, [bumpCapacityFor]);

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

      {/* ---------- Body: three columns on wide screens, stacked on narrow ---- */}
      <div className="max-w-[1600px] w-full mx-auto px-6 py-6 grid gap-6 grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
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

        {/* ============== CENTER: Door scanner + recent activity ============== */}
        <div className="flex flex-col gap-6 min-w-0">
          <DoorSessionBar
            activeSession={activeSession}
            activeEvent={activeEvent}
            busy={sessionBusy}
            error={sessionError}
            onStart={() => {
              setSessionError('');
              setStartPickerOpen(true);
              // Lazy-load the wide event list every time the picker opens.
              // Cheap query, and it means the manager sees an event they
              // just created in another tab without a page reload.
              setPickerEventsError('');
              setPickerEventsLoading(true);
              fetch('/api/capacity/guestlist/events?include_all=1', { cache: 'no-store' })
                .then((res) => res.json().then((json) => ({ ok: res.ok, json })))
                .then(({ ok, json }) => {
                  if (!ok) {
                    setPickerEventsError(json?.error || 'Could not load events.');
                    setPickerEvents([]);
                  } else {
                    setPickerEvents(json?.events || []);
                  }
                })
                .catch(() => setPickerEventsError('Network error loading events.'))
                .finally(() => setPickerEventsLoading(false));
            }}
            onEnd={() => { setSessionError(''); setConfirmEndOpen(true); }}
          />
          <UnifiedDoorScanner
            activeEvent={activeEvent}
            doorSessionId={doorSessionId}
            onActivity={logActivity}
            getBumpWarning={getScannerBumpWarning}
          />
          <RecentActivityPanel entries={recentActivity} />
        </div>

        {startPickerOpen && (
          <StartEventOverlay
            events={pickerEvents}
            loading={pickerEventsLoading}
            loadError={pickerEventsError}
            busy={sessionBusy}
            errorMessage={sessionError}
            onPick={startDoorSession}
            onCancel={() => setStartPickerOpen(false)}
          />
        )}
        {confirmEndOpen && activeSession && (
          <ConfirmEndOverlay
            event={activeEvent}
            busy={sessionBusy}
            errorMessage={sessionError}
            onConfirm={endDoorSession}
            onCancel={() => setConfirmEndOpen(false)}
          />
        )}

        {/* ============== RIGHT: Issue trial pass ============================= */}
        {/* ManualTrialPassForm expects the --auth-* CSS variables set up by
            AuthenticatedThemeProvider; wrap the panel in the provider (team
            scope, dark) so we don't have to re-declare its theme here. */}
        <AuthenticatedThemeProvider scope="team">
          <div className="flex flex-col gap-4">
            <section
              className="rounded-2xl border p-4"
              style={{ background: '#111', borderColor: 'rgba(255,255,255,0.08)' }}
            >
              <div className="mb-3">
                <div className="text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: '#8a8a8a' }}>
                  Trial Pass · Override
                </div>
                <h2 className="text-[16px] font-bold leading-tight" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  Issue a Trial SDG Pass
                </h2>
                <p className="text-[11px] mt-1 leading-snug" style={{ color: '#8a8a8a' }}>
                  For guests who can&apos;t receive the SMS code. Bypasses verification and logs you as the issuer.
                </p>
              </div>
              <ManualTrialPassForm createdByEmail={staffEmail} compact />
            </section>

            {/* Chronological check-in list — photo + name + kind + time. */}
            <CheckedInListPanel entries={checkedInHistory} />
          </div>
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
            // Guest-list check-ins land in the same "last 5" panel as scanned
            // admits so the manager sees one unified stream.
            logActivity({
              id: `guestlist:${updated.id}`,
              kind: 'guestlist',
              name: updated.guest_name,
              detail: updated.partner_name || 'Guest list',
              result: 'admitted',
              at: Date.now(),
            });
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

function RecentActivityPanel({ entries }) {
  return (
    <section
      className="rounded-2xl border"
      style={{ background: '#111', borderColor: 'rgba(255,255,255,0.08)' }}
    >
      <div
        className="px-5 py-3 border-b flex items-baseline justify-between gap-2"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div>
          <div className="text-[11px] font-bold tracking-[0.16em] uppercase" style={{ color: '#8a8a8a' }}>
            Recent
          </div>
          <h3 className="text-[15px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Last 5 admits
          </h3>
        </div>
        <div className="text-[11px]" style={{ color: '#8a8a8a' }}>
          this session
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="px-5 py-6 text-center text-[13px]" style={{ color: '#8a8a8a' }}>
          Nobody in yet.
        </div>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          {entries.map((e) => (
            <RecentActivityRow key={e.at + ':' + e.id} entry={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

const KIND_LABEL = {
  guestlist: 'Guest list',
  trial_pass: 'Trial pass',
  member_id: 'Member',
  ticket: 'Ticket',
};
const RESULT_COLOR = {
  admitted: '#7CFC9B',
  rejected: '#ff8a8a',
  denied: '#ffb84d',
};
const RESULT_LABEL = {
  admitted: 'In',
  rejected: 'Rejected',
  denied: 'Denied',
};

function RecentActivityRow({ entry }) {
  const color = RESULT_COLOR[entry.result] || '#8a8a8a';
  return (
    <li className="px-5 py-3 flex items-center gap-3" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
      <span
        className="inline-block w-2 h-2 rounded-full shrink-0"
        style={{ background: color }}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-bold truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {entry.name}
        </div>
        <div className="text-[11px] mt-0.5 truncate" style={{ color: '#8a8a8a' }}>
          {KIND_LABEL[entry.kind] || 'Door'}
          {entry.detail ? ` · ${entry.detail}` : ''}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[10px] font-bold tracking-[0.1em] uppercase" style={{ color }}>
          {RESULT_LABEL[entry.result] || entry.result}
        </div>
        <div className="text-[11px] tabular-nums" style={{ color: '#8a8a8a' }}>
          {formatActivityTime(entry.at)}
        </div>
      </div>
    </li>
  );
}

// Chronological check-in list (newest first) rendered under the trial-pass
// panel. Photo thumbnails come from the short-lived signed URL captured on
// the preview call; if none is available (guest-list check-ins or a scan
// with no photo on file) we fall back to a monogram avatar so the row still
// reads at a glance. Only entries with result === 'admitted' land here.
function CheckedInListPanel({ entries }) {
  return (
    <section
      className="rounded-2xl border"
      style={{ background: '#111', borderColor: 'rgba(255,255,255,0.08)' }}
    >
      <div
        className="px-4 py-3 border-b flex items-baseline justify-between gap-2"
        style={{ borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div>
          <div className="text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: '#8a8a8a' }}>
            Tonight
          </div>
          <h3 className="text-[14px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Checked in
          </h3>
        </div>
        <div className="text-[11px] tabular-nums" style={{ color: '#8a8a8a' }}>
          {entries.length}
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12px]" style={{ color: '#8a8a8a' }}>
          Nobody in yet.
        </div>
      ) : (
        <ul
          className="divide-y overflow-y-auto"
          style={{ borderColor: 'rgba(255,255,255,0.05)', maxHeight: 380 }}
        >
          {entries.map((e) => (
            <CheckedInRow key={e.at + ':' + e.id} entry={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

function monogram(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

function CheckedInRow({ entry }) {
  const initials = monogram(entry.name);
  return (
    <li
      className="px-4 py-2.5 flex items-center gap-3"
      style={{ borderColor: 'rgba(255,255,255,0.05)' }}
    >
      {entry.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.photoUrl}
          alt=""
          className="w-10 h-10 rounded-full object-cover shrink-0"
          style={{ background: '#000', border: '1px solid rgba(255,255,255,0.1)' }}
        />
      ) : (
        <div
          className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold tracking-[0.05em]"
          style={{
            background: 'rgba(217,196,140,0.15)',
            color: '#d9c48c',
            border: '1px solid rgba(217,196,140,0.3)',
            fontFamily: "'Plus Jakarta Sans', sans-serif",
          }}
          aria-hidden
        >
          {initials}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div
          className="text-[13px] font-bold truncate leading-tight"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          {entry.name}
        </div>
        <div className="text-[10px] mt-0.5 truncate" style={{ color: '#8a8a8a' }}>
          {KIND_LABEL[entry.kind] || 'Door'}
          {entry.detail ? ` · ${entry.detail}` : ''}
        </div>
      </div>
      <div
        className="text-[10px] tabular-nums shrink-0"
        style={{ color: '#8a8a8a' }}
      >
        {formatActivityTime(entry.at)}
      </div>
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

// ============================================================================
// Door session controls
// ============================================================================
//
// The bar sits directly above the scanner so staff cannot miss the "start an
// event first" state. Copy is deliberately blunt \u2014 nobody at the door in the
// middle of a rush should have to interpret a subtle icon to know if ticket
// scanning is armed.

function DoorSessionBar({ activeSession, activeEvent, busy, error, onStart, onEnd }) {
  if (activeSession) {
    const eventTitle = activeEvent?.title || 'Event live';
    const opened = activeSession.opened_at
      ? new Date(activeSession.opened_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '';
    return (
      <section
        className="rounded-2xl border p-3 flex items-center gap-3"
        style={{ background: 'rgba(124,252,155,0.06)', borderColor: 'rgba(124,252,155,0.35)' }}
      >
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: '#7CFC9B' }}>
            Event running
          </div>
          <div className="text-[15px] font-bold truncate leading-tight" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            {eventTitle}
          </div>
          {opened && (
            <div className="text-[11px]" style={{ color: '#8a8a8a' }}>
              Opened {opened}
            </div>
          )}
          {error && (
            <div className="text-[12px] mt-1" style={{ color: '#ff8a8a' }}>{error}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onEnd}
          disabled={busy}
          className="rounded-full px-4 py-2 text-[12px] font-bold tracking-[0.12em] uppercase border"
          style={{ borderColor: 'rgba(255,138,138,0.5)', color: '#ff8a8a', background: 'transparent' }}
        >
          End Event
        </button>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border p-4 flex items-center gap-4"
      style={{ background: 'rgba(255,184,77,0.06)', borderColor: 'rgba(255,184,77,0.35)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-bold tracking-[0.16em] uppercase" style={{ color: '#ffb84d' }}>
          No event running
        </div>
        <div className="text-[14px]" style={{ color: '#e5e5e5' }}>
          Start an event to scan tickets. Member IDs and trial passes still work without one.
        </div>
        {error && (
          <div className="text-[12px] mt-1" style={{ color: '#ff8a8a' }}>{error}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onStart}
        disabled={busy}
        className="rounded-full px-5 py-2 text-[12px] font-bold tracking-[0.12em] uppercase"
        style={{ background: '#7CFC9B', color: '#0a0a0a' }}
      >
        Start Event
      </button>
    </section>
  );
}

// Full-screen picker \u2014 kept as an overlay (not a select) so the manager can
// see event dates in a scannable list without hunting the native dropdown UI.
function StartEventOverlay({
  events,
  loading = false,
  loadError = '',
  busy,
  errorMessage,
  onPick,
  onCancel,
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const filtered = q
    ? events.filter((e) =>
        (e.title || '').toLowerCase().includes(q)
        || (e.event_date || '').toLowerCase().includes(q))
    : events;

  return (
    <OverlayFrame onCancel={onCancel}>
      <div className="text-[11px] font-bold tracking-[0.16em] uppercase mb-2" style={{ color: '#8a8a8a' }}>
        Start event
      </div>
      <h2 className="text-[22px] font-bold mb-4" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        Which event are you running the door for?
      </h2>

      {events.length > 0 && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by title or date…"
          className="w-full mb-3 rounded-xl border px-3 py-2 text-[14px]"
          style={{
            background: '#0a0a0a',
            borderColor: 'rgba(255,255,255,0.15)',
            color: '#f5f5f5',
          }}
          autoFocus
        />
      )}

      {loading ? (
        <div className="text-[13px]" style={{ color: '#8a8a8a' }}>Loading events…</div>
      ) : loadError ? (
        <div className="text-[13px]" style={{ color: '#ff8a8a' }}>{loadError}</div>
      ) : events.length === 0 ? (
        <div className="rounded-xl border p-4" style={{ borderColor: 'rgba(255,255,255,0.12)', background: '#0a0a0a' }}>
          <div className="text-[13px] mb-3" style={{ color: '#c9c9c9' }}>
            No upcoming events on the calendar.
          </div>
          <Link
            href="/bananas/events/new"
            className="inline-block rounded-full px-4 py-2 text-[12px] font-bold tracking-[0.12em] uppercase"
            style={{ background: '#7CFC9B', color: '#0a0a0a' }}
          >
            Create an event →
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-[13px]" style={{ color: '#8a8a8a' }}>
          No events match “{query}”.
        </div>
      ) : (
        <ul className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
          {filtered.map((evt) => (
            <li key={evt.id}>
              <button
                type="button"
                onClick={() => onPick(evt.id)}
                disabled={busy}
                className="w-full text-left rounded-xl border px-4 py-3 hover:border-white/30 transition-colors"
                style={{ borderColor: 'rgba(255,255,255,0.12)', background: '#0a0a0a' }}
              >
                <div className="text-[11px]" style={{ color: '#8a8a8a' }}>
                  {formatEventDate(evt.event_date)}
                </div>
                <div className="text-[16px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
                  {evt.title}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {errorMessage && (
        <div className="text-[12px] mt-3" style={{ color: '#ff8a8a' }}>{errorMessage}</div>
      )}
      <div className="flex items-center justify-between mt-4">
        <Link
          href="/bananas/events/new"
          className="text-[12px] font-bold tracking-[0.12em] uppercase"
          style={{ color: '#7CFC9B' }}
        >
          + New event
        </Link>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-[12px] font-bold tracking-[0.12em] uppercase"
          style={{ color: '#8a8a8a' }}
        >
          Cancel
        </button>
      </div>
    </OverlayFrame>
  );
}

function ConfirmEndOverlay({ event, busy, errorMessage, onConfirm, onCancel }) {
  return (
    <OverlayFrame onCancel={onCancel}>
      <div className="text-[11px] font-bold tracking-[0.16em] uppercase mb-2" style={{ color: '#8a8a8a' }}>
        End event
      </div>
      <h2 className="text-[22px] font-bold mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        End the door for {event?.title || 'this event'}?
      </h2>
      <div className="text-[13px] mb-4" style={{ color: '#8a8a8a' }}>
        Ticket scans will stop being accepted. Member IDs and trial passes still work.
      </div>
      {errorMessage && (
        <div className="text-[12px] mb-3" style={{ color: '#ff8a8a' }}>{errorMessage}</div>
      )}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="text-[12px] font-bold tracking-[0.12em] uppercase"
          style={{ color: '#8a8a8a' }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="rounded-full px-5 py-2 text-[12px] font-bold tracking-[0.12em] uppercase"
          style={{ background: '#ff8a8a', color: '#0a0a0a' }}
        >
          {busy ? 'Ending\u2026' : 'End event'}
        </button>
      </div>
    </OverlayFrame>
  );
}

function OverlayFrame({ children, onCancel }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={(e) => {
        // Backdrop click cancels; child clicks do not (stopPropagation on the card).
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div
        className="w-full max-w-[520px] rounded-2xl border p-6"
        style={{ background: '#111', borderColor: 'rgba(255,255,255,0.12)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessCheck } from '../components/AccessRestrictions';
import EditLegalName from '../components/EditLegalName';
import { mergeArrivals, subjectKey } from '@/lib/capacity/arrival-roster';

const POLL_MS = 15000;
function formatTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago',
  }) : '';
}
function GuestPhoto({ guest, large = false, onUnavailable }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [guest.photo_url]);
  const size = large ? { width: 80, height: 90 } : { width: 48, height: 56 };
  return guest.photo_url && !failed
    // Signed private URLs are intentionally rendered without the image proxy.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={guest.photo_url} alt={`${guest.full_name} profile`} onError={() => { setFailed(true); onUnavailable?.(); }}
      className="shrink-0 rounded-lg object-cover" style={size} />
    : <span aria-label="Profile photo unavailable" className="shrink-0 rounded-lg flex items-center justify-center text-sm font-bold"
      style={{ ...size, background: '#292929', color: '#aaa' }}>
      {(guest.full_name || '?').split(/\s+/).slice(0, 2).map(n => n[0]).join('')}
    </span>;
}

export default function TonightSignInsPanel({ onCheckIn }) {
  const [signins, setSignins] = useState([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ query: '', rows: [], truncated: false });
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [note, setNote] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedGuest, setSelectedGuest] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [accessClear, setAccessClear] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [photoUnavailable, setPhotoUnavailable] = useState(false);
  const [checkInError, setCheckInError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const dialogRef = useRef(null);
  const searchRef = useRef(null);
  const requestVersion = useRef(0);
  const active = useRef(true);
  const busy = useRef(false);
  const shift = useRef(null);
  const trimmed = query.trim();
  const isSearch = Boolean(trimmed);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const res = await fetch('/api/team/trial-pass/today', { cache: 'no-store' });
      const json = await res.json();
      if (!active.current || version !== requestVersion.current) return;
      if (!res.ok) throw new Error(json.error || 'Could not load tonight’s roster.');
      // A normal refresh replaces the snapshot, including after 6 AM rollover.
      // The database, not localStorage or the browser clock, owns check-in state.
      shift.current = json.shiftDay;
      setSignins(json.signins || []);
      setError('');
      setLastUpdated(new Date());
    } catch (err) {
      if (active.current && version === requestVersion.current) setError(err.message || 'Network error loading the roster.');
    } finally {
      if (active.current && version === requestVersion.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    active.current = true;
    load();
    const refresh = () => { load(); setRefreshKey(key => key + 1); };
    const interval = setInterval(refresh, POLL_MS);
    window.addEventListener('focus', refresh);
    window.addEventListener('sdg:roster-changed', refresh);
    window.addEventListener('sdg:legal-name-changed', refresh);
    return () => {
      active.current = false;
      // This is a request-generation counter, not a captured DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++requestVersion.current;
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('sdg:roster-changed', refresh);
      window.removeEventListener('sdg:legal-name-changed', refresh);
    };
  }, [load]);

  useEffect(() => {
    const controller = new AbortController();
    setSearchError('');
    if (trimmed.length < 2) { setSearching(false); return () => controller.abort(); }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/team/trial-pass/today?q=${encodeURIComponent(trimmed)}`, {
          cache: 'no-store', signal: controller.signal,
        });
        const json = await res.json();
        if (controller.signal.aborted) return;
        if (!res.ok) throw new Error(json.error || 'Guest search is unavailable.');
        setSearchResults({ query: trimmed, rows: json.signins || [], truncated: Boolean(json.truncated) });
      } catch (err) {
        if (!controller.signal.aborted) setSearchError(err.message || 'Guest search is unavailable.');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [trimmed, refreshKey]);

  const selectGuest = (row) => {
    setAccessClear(false);
    setEditingName(false);
    setPhotoUnavailable(false);
    setCheckInError('');
    setSelectedGuest(row);
  };
  useEffect(() => {
    if (selectedGuest && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    if (!selectedGuest && dialogRef.current?.open) dialogRef.current.close();
  }, [selectedGuest]);

  const handleToggle = async (row) => {
    if (busy.current || row.checked_in_at || !accessClear || editingName
      || photoUnavailable || row.admission_reason) return;
    busy.current = true;
    setBusyId(subjectKey(row));
    setCheckInError('');
    try {
      const result = await onCheckIn(row);
      if (!result?.row?.checked_in_at) throw new Error('Check-in was not confirmed. Hold entry and refresh.');
      // Discard every GET started before this commit. Use the server timestamp.
      ++requestVersion.current;
      const changedShift = shift.current !== result.shiftDay;
      shift.current = result.shiftDay;
      setSignins(previous => mergeArrivals(changedShift ? [] : previous, [result.row]));
      setQuery('');
      setSelectedGuest(null);
      setNote(result.alreadyCheckedIn ? `${row.full_name} is already checked in tonight.`
        : `${row.full_name} checked in. Added to the top of tonight’s roster.`);
      window.dispatchEvent(new Event('sdg:roster-changed'));
    } catch (err) {
      setCheckInError(err.message || 'Check-in failed. Hold entry.');
      setAccessClear(false);
      window.dispatchEvent(new Event('sdg:access-changed'));
    } finally {
      busy.current = false;
      setBusyId(null);
    }
  };

  const filtered = isSearch ? (searchResults.query === trimmed ? searchResults.rows : []) : signins;
  const inCount = signins.filter(row => row.checked_in_at).length;
  const waiting = isSearch ? searching || (!searchError && trimmed.length >= 2 && searchResults.query !== trimmed) : loading;
  const visibleError = isSearch ? searchError : error;
  return (
    <section className="rounded-2xl border overflow-hidden flex flex-col"
      style={{ background: '#111', color: '#f5f5f5', borderColor: '#272727', minHeight: 560 }}>
      <div className="px-5 py-4 border-b" style={{ borderColor: '#272727' }}>
        <div className="text-[11px] font-bold tracking-[0.14em] uppercase" style={{ color: '#aaa' }}>Front room · Arrival roster</div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-[20px] font-bold">Sign-ins &amp; guest search</h2>
          <span className="text-[12px]" style={{ color: '#7cfc9b' }}>{inCount} checked in</span>
        </div>
      </div>
      <div className="px-5 pt-4 pb-2">
        <div className="flex gap-2">
          <input ref={searchRef} type="search" value={query} maxLength={120}
            onChange={e => { setQuery(e.target.value); setNote(''); }}
            className="fd-input min-w-0" placeholder="Search all guests by name…"
            autoComplete="off" autoCorrect="off" spellCheck={false} aria-label="Search all guests by name" />
          {query && <button type="button" className="px-3 rounded-lg text-sm border border-white/20"
            onClick={() => { setQuery(''); searchRef.current?.focus(); }}>Clear</button>}
        </div>
        <p className="text-[12px] mt-2 leading-relaxed" style={{ color: '#aaa' }}>
          Search existing guests and members, not just tonight’s sign-ins.
        </p>
      </div>
      {(visibleError || note) && <div className="mx-5 my-2 p-3 rounded-lg text-[13px]" role={visibleError ? 'alert' : 'status'}
        style={{ color: visibleError ? '#ff9e9e' : '#7cfc9b', background: visibleError ? '#301919' : '#15271b' }}>
        {visibleError || note}
      </div>}
      <div className="px-5 pt-3 pb-2 flex justify-between gap-3 text-[11px]" style={{ color: '#aaa' }}>
        <span className="font-bold uppercase tracking-[0.12em]">{isSearch ? 'All matching guests' : 'Tonight’s sign-ins'}</span>
        <span>{!waiting && filtered.length} {!waiting && (isSearch ? 'matches' : 'people')}</span>
      </div>
      <div className="flex-1 px-3 pb-3 overflow-y-auto" aria-busy={waiting}>
        {waiting ? <p className="py-10 text-center text-sm" style={{ color: '#aaa' }}>Loading…</p>
          : isSearch && trimmed.length < 2 ? <p className="py-10 text-center text-sm">Enter at least two letters to search all guests.</p>
          : visibleError ? <p className="py-10 text-center text-sm" style={{ color: '#aaa' }}>Hold entry until the roster can be refreshed.</p>
          : filtered.length === 0 ? <p className="py-10 px-2 text-center text-sm" style={{ color: '#aaa' }}>
            {isSearch ? 'No guests found. Check the spelling or help the guest sign up.'
              : 'No sign-ins yet tonight. New Trial Pass signups will appear here, or search for a returning guest.'}
          </p>
          : <ul>
            {filtered.map(row => {
              const isIn = Boolean(row.checked_in_at);
              const isBusy = busyId === subjectKey(row);
              return <li key={subjectKey(row)} className="flex items-center gap-3 px-2 py-3 border-t" style={{ borderColor: '#282828' }}>
                <GuestPhoto guest={row} />
                <div className="flex-1 min-w-0">
                  <button type="button" className="text-left text-[15px] font-semibold break-words"
                    onClick={() => selectGuest(row)}>{row.full_name}</button>
                  <div className="text-[11px] mt-1 leading-relaxed" style={{ color: '#aaa' }}>
                    {row.label}{!isSearch && ` · ${row.activity_kind === 'check_in' ? 'Checked in' : 'Signed up'} ${formatTime(row.activity_at)}`}
                  </div>
                  {!isIn && row.admission_reason && <span className="text-[11px]" style={{ color: '#ffc269' }}>Review admission</span>}
                </div>
                <button type="button" onClick={() => selectGuest(row)} disabled={isIn || isBusy}
                  aria-label={isIn ? `${row.full_name} checked in` : `${row.admission_reason ? 'Review' : 'Check in'} ${row.full_name}`}
                  aria-pressed={isIn} className="shrink-0 rounded-lg px-3 py-2 text-[12px] font-semibold border"
                  style={{ minHeight: 44, borderColor: '#363636', color: isIn ? '#7cfc9b' : '#f5f5f5' }}>
                  {isIn ? '✓ In' : isBusy ? 'Checking…' : row.admission_reason ? 'Review' : 'Check in'}
                </button>
              </li>;
            })}
          </ul>}
      </div>
      <div className="mx-5 py-3 border-t text-[11px] leading-relaxed" style={{ borderColor: '#272727', color: '#aaa' }}>
        {isSearch ? <>
          {searchResults.truncated && <strong className="block" style={{ color: '#ffc269' }}>More matches exist. Enter more of the name.</strong>}
          Search does not change the roster. Check-in adds the guest at the top.
        </> : <>Newest signup or check-in first. Later arrivals always appear above earlier ones.
          {lastUpdated && <span className="block">Updated {formatTime(lastUpdated.toISOString())}</span>}</>}
      </div>

      <dialog ref={dialogRef} aria-labelledby="roster-guest-title" className="roster-dialog"
        onCancel={e => { e.preventDefault(); if (!busy.current) setSelectedGuest(null); }}>
        {selectedGuest && <>
          <div className="flex items-center gap-4 mb-4">
            <GuestPhoto key={subjectKey(selectedGuest)} guest={selectedGuest} large onUnavailable={() => setPhotoUnavailable(true)} />
            <div><div className="text-[11px] uppercase tracking-widest" style={{ color: '#aaa' }}>Confirm guest</div>
              <h3 id="roster-guest-title" className="text-xl font-bold">{selectedGuest.full_name}</h3>
              <p className="text-sm mt-1" style={{ color: '#aaa' }}>{selectedGuest.label}</p></div>
          </div>
          {selectedGuest.admission_reason && <p className="p-3 rounded-lg text-sm mb-3" style={{ background: '#302719', color: '#ffce82' }}>{selectedGuest.admission_reason}</p>}
          {photoUnavailable && <p role="alert" className="text-sm" style={{ color: '#ff9e9e' }}>Photo could not load. Close and reopen the guest after refreshing.</p>}
          <EditLegalName key={`edit:${subjectKey(selectedGuest)}`} subject={{ kind: selectedGuest.kind, id: selectedGuest.id }}
            fullName={selectedGuest.full_name} onEditing={setEditingName} disabled={Boolean(busyId)}
            onSaved={fullName => { setSelectedGuest(previous => ({ ...previous, full_name: fullName })); setAccessClear(false); }} />
          <AccessCheck key={`access:${subjectKey(selectedGuest)}`} subject={{ kind: selectedGuest.kind, id: selectedGuest.id }} onStatus={setAccessClear} />
          {selectedGuest.checked_in_at && <p className="text-sm mt-3" style={{ color: '#7cfc9b' }}>Already checked in tonight.</p>}
          {checkInError && <p role="alert" className="text-sm mt-3" style={{ color: '#ff9e9e' }}>{checkInError}</p>}
          <div className="flex gap-3 mt-5">
            <button type="button" disabled={Boolean(busyId)} className="flex-1 border border-white/20 rounded-lg p-3"
              onClick={() => setSelectedGuest(null)}>Close</button>
            {!selectedGuest.checked_in_at && <button type="button" className="flex-1 rounded-lg p-3 font-bold disabled:opacity-40"
              style={{ background: '#7cfc9b', color: '#071009' }}
              disabled={!accessClear || editingName || Boolean(busyId) || photoUnavailable || Boolean(selectedGuest.admission_reason)}
              onClick={() => handleToggle(selectedGuest)}>{busyId ? 'Checking in…' : 'Check in guest'}</button>}
          </div>
        </>}
      </dialog>
      <style jsx>{`
        .roster-dialog { color: #f5f5f5; background: #171717; border: 1px solid #424242;
          border-radius: 16px; padding: 24px; width: min(480px, calc(100vw - 32px));
          margin: auto; max-height: calc(100dvh - 32px); overflow-y: auto; }
        .roster-dialog::backdrop { background: rgba(0,0,0,.75); }
        .roster-dialog input[type=checkbox] { width: 18px; height: 18px; accent-color: #7cfc9b; }
      `}</style>
    </section>
  );
}

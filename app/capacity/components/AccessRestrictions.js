'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const API = '/api/capacity/access-restrictions';
const button = 'rounded-lg border border-white/20 px-3 py-2 text-sm font-semibold disabled:opacity-40';
const field = 'block w-full rounded-lg border border-white/20 bg-[#111] px-3 py-2 text-sm text-white';
export function openRestrictions(subject = null, name = '') {
  window.dispatchEvent(new CustomEvent('sdg:restrictions-open', { detail: { subject, name } }));
}
function refreshAccess() { window.dispatchEvent(new Event('sdg:access-changed')); }
async function save(payload) {
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Could not save.');
  refreshAccess();
  return json;
}
function date(value) { return value ? new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' }) : ''; }

function RecordNotes({ row }) {
  return <div className="space-y-2 break-words">
    <p className="text-sm whitespace-pre-wrap">{row.reason}</p>
    {row.identifying_details && <p className="text-sm text-neutral-300 whitespace-pre-wrap">{row.identifying_details}</p>}
    {row.expires_at && <p className="text-xs text-amber-200">Expires {date(row.expires_at)}</p>}
    {row.lifted_at && <p className="text-sm text-green-300">Lifted {date(row.lifted_at)}: {row.lift_reason}</p>}
    {(row.events || []).map(event => <div key={event.id} className="border-t border-white/10 pt-2">
      <div className="text-xs text-neutral-400">{event.actor_label} · {date(event.created_at)} · {event.action.replaceAll('_', ' ')}</div>
      <div className="text-sm whitespace-pre-wrap">{event.comment}</div>
    </div>)}
  </div>;
}

function InlineNote({ row }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await save({ action: 'note', id: row.id, comment: text }); setText(''); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-3 space-y-2">
    <label className="block text-xs">Add staff note<textarea className={field} required maxLength={2000} value={text} onChange={e => setText(e.target.value)} /></label>
    <button className={button} disabled={busy || !text.trim()} type="submit">Save note</button>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
  </form>;
}

// Embedded beside the existing profile. A new scan/selection starts pending;
// neither network errors nor a stale prior guest can enable the Admit button.
export function AccessCheck({ subject, onStatus, extra = null }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const callback = useRef(onStatus);
  callback.current = onStatus;
  const kind = subject?.kind, id = subject?.id;
  const extraKey = JSON.stringify(extra);
  useEffect(() => {
    let alive = true;
    let serial = 0;
    setData(null);
    callback.current?.(false);
    async function load() {
      const current = ++serial;
      try {
        const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'check', subject: { kind, id }, extra: JSON.parse(extraKey) }), cache: 'no-store' });
        const json = await res.json();
        if (!alive || current !== serial) return;
        if (!res.ok) throw new Error(json.error || 'Access check unavailable. Hold entry.');
        setData(json); setError('');
        callback.current?.(json.status === 'clear');
      } catch (err) {
        if (alive && current === serial) { setError(err.message); callback.current?.(false); }
      }
    }
    function changed() { callback.current?.(false); load(); }
    load();
    const timer = setInterval(load, 15000);
    window.addEventListener('sdg:access-changed', changed);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('sdg:access-changed', changed); };
  }, [kind, id, extraKey]);
  async function identify(row, action) {
    if (!note.trim()) { setError('Explain how you verified their identity before saving.'); return; }
    setBusy(true); setError('');
    try { await save({ action, id: row.id, subject, extra, comment: note }); setNote(''); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="my-3 rounded-xl border border-white/15 bg-[#151515] p-3" aria-label="Guest access status">
    <div className="flex items-center justify-between gap-2">
      <strong className={`text-sm ${data?.status === 'blocked' ? 'text-red-300' : data?.status === 'verify' ? 'text-amber-200' : 'text-green-300'}`}>
        {error ? 'HOLD ENTRY' : !data ? 'Checking access…' : data.status === 'blocked' ? 'DO NOT ADMIT' : data.status === 'verify' ? 'VERIFY IDENTITY' : 'No active restriction found'}
      </strong>
      <button type="button" className={button} onClick={() => openRestrictions(subject, data?.full_name)}>Restrict / notes</button>
    </div>
    <p className="text-xs text-neutral-400 mt-1">Access restrictions are separate from pass, ticket, and membership eligibility.</p>
    {error && <p role="alert" className="text-sm text-red-300 mt-2">{error}</p>}
    {data?.matches.map(row => <div key={row.id} className="mt-3 border-t border-white/15 pt-3">
      <div className="font-bold">{row.full_name} · {row.kind === 'banned' ? 'Banned' : row.kind === 'review' ? 'Manager review' : 'Temporary restriction'}</div>
      <p className="text-xs text-amber-200 my-1">{row.match === 'confirmed' ? 'Confirmed profile match. Only an authorized manager can lift this restriction.' : 'Possible match only. Compare identity and identifying notes before deciding.'}</p>
      <RecordNotes row={row} />
      <InlineNote row={row} />
      {row.match === 'possible' && <div className="space-y-2 mt-3">
        <label className="block text-xs">Identity verification note
          <textarea className={field} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} placeholder="How did you confirm these are the same or different people?" />
        </label>
        <div className="flex gap-2 flex-wrap">
          <button className={button} type="button" disabled={busy} onClick={() => identify(row, 'same_person')}>Same person: block entry</button>
          <button className={button} type="button" disabled={busy} onClick={() => identify(row, 'different_person')}>Different person: save verification</button>
        </div>
      </div>}
    </div>)}
    {data?.history?.map(row => <details key={row.id} className="mt-3 border-t border-white/15 pt-2">
      <summary className="text-sm cursor-pointer">{row.full_name}: {row.lifted_at ? 'lifted restriction' : 'expired restriction'}{row.match === 'possible' ? ' (possible name/contact match)' : ''}</summary>
      <p className="text-xs text-neutral-400 my-2">Historical record only. This restriction does not block entry.</p>
      <RecordNotes row={row} /><InlineNote row={row} />
    </details>)}
  </section>;
}

export default function AccessRestrictions() {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState(false);
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [confirmLift, setConfirmLift] = useState(false);
  const [confirmManager, setConfirmManager] = useState(null);
  const dialog = useRef(null);
  useEffect(() => {
    function show(event) {
      setSubject(event.detail?.subject || null);
      setName(event.detail?.name || '');
      setCreating(Boolean(event.detail?.subject));
      setSelected(null); setError(''); setComment(''); setConfirmLift(false); setConfirmManager(null); setOpen(true);
    }
    window.addEventListener('sdg:restrictions-open', show);
    return () => window.removeEventListener('sdg:restrictions-open', show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus?.(); };
  }, [open]);
  const load = useCallback(async (signal) => {
    const res = await fetch(`${API}?q=${encodeURIComponent(query)}&page=${page}&history=${history ? 1 : 0}`, { cache: 'no-store', signal });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    setData(json);
  }, [query, page, history]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setData(null);
    const timer = setTimeout(() => load(controller.signal).catch(e => { if (e.name !== 'AbortError') setError(e.message); }), 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, load]);
  async function mutate(payload) {
    setBusy(true); setError('');
    try {
      const result = await save(payload);
      setCreating(false); setSubject(null); setComment(''); setConfirmLift(false); setConfirmManager(null); setSelected(result.id);
      await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function create(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form);
    // Duration avoids browser-local timezone ambiguity. All displayed dates
    // are America/Chicago; expiry is persisted as an absolute instant.
    await mutate({ ...values, action: 'create', subject, aliases: values.aliases.split(',').map(s => s.trim()).filter(Boolean),
      expires_at: values.kind === 'temporary' ? new Date(Date.now() + Number(values.duration) * 3600000).toISOString() : null });
  }
  const row = data?.rows.find(r => r.id === selected);
  return <>
    <button type="button" className={button} onClick={() => openRestrictions()}>Banned / restricted</button>
    {open && <dialog ref={dialog} onCancel={() => setOpen(false)}
      className="m-0 ml-auto h-[100dvh] max-h-none w-full max-w-[560px] bg-[#101010] text-white p-0 border-l border-white/20 backdrop:bg-black/70"
      aria-labelledby="restrictions-title">
      <div className="p-5 space-y-4">
        <header className="flex justify-between items-center gap-3">
          <h2 id="restrictions-title" className="text-xl font-bold">Banned / restricted guests</h2>
          <button type="button" className={button} onClick={() => setOpen(false)}>Close</button>
        </header>
        <p className="text-sm text-neutral-400">Private staff records. Record specific conduct and relevant identifying details, not assumptions or protected characteristics.</p>
        {error && <p role="alert" className="rounded-lg border border-red-500/40 p-3 text-sm text-red-300">{error}</p>}
        <div className="flex gap-2">
          <button className={button} type="button" onClick={() => { setCreating(true); setSelected(null); setSubject(null); setName(''); }}>Add person manually</button>
          <button className={button} type="button" onClick={() => { setCreating(false); setSelected(null); }}>View list</button>
        </div>
        {creating ? <form className="space-y-3" onSubmit={create}>
          {subject && <p className="text-sm text-amber-200">Linked to this guest profile. Confirm the person&apos;s identity before restricting.</p>}
          <label className="block text-sm">Full name<input autoFocus required maxLength={160} name="full_name" className={field} value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="block text-sm">Known aliases, comma-separated<input name="aliases" className={field} maxLength={1000} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Email (optional)<input name="email" type="email" maxLength={254} className={field} /></label>
            <label className="text-sm">Phone (optional)<input name="phone" maxLength={40} className={field} /></label>
          </div>
          <label className="block text-sm">Restriction
            <select name="kind" aria-label="Restriction" className={field}><option value="banned">Banned: no entry</option><option value="temporary">Temporary: no entry until expiry</option><option value="review">Manager review: hold entry</option></select>
          </label>
          <label className="block text-sm">Duration (temporary restrictions only)
            <select name="duration" aria-label="Duration (temporary restrictions only)" className={field}><option value="12">12 hours</option><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option></select>
          </label>
          <label className="block text-sm">Reason / initial note<textarea required name="reason" maxLength={2000} className={field} rows={3} /></label>
          <label className="block text-sm">Identifying details / staff instructions<textarea name="identifying_details" maxLength={2000} className={field} rows={3} /></label>
          <p className="text-xs text-neutral-400">No trial pass or membership is required. Manual name matches require verification at the door.</p>
          <button type="submit" disabled={busy} className={`${button} bg-red-950`}>{busy ? 'Saving…' : 'Save restriction'}</button>
        </form> : row ? <div className="space-y-3">
          <button type="button" className={button} onClick={() => setSelected(null)}>Back to list</button>
          <h3 className="text-xl font-bold">{row.full_name}</h3>
          <div className="text-sm text-amber-200">{row.kind === 'banned' ? 'Banned' : row.kind === 'review' ? 'Manager review' : 'Temporary restriction'}</div>
          <RecordNotes row={row} />
          <label className="block text-sm">Add note / reason to lift<textarea className={field} value={comment} onChange={e => setComment(e.target.value)} maxLength={2000} rows={3} /></label>
          <div className="flex gap-2 flex-wrap">
            <button type="button" disabled={busy || !comment.trim()} className={button} onClick={() => mutate({ action: 'note', id: row.id, comment })}>Save note</button>
            {data.canLift && !row.lifted_at && <button type="button" disabled={busy || !comment.trim()} className={button} onClick={() => setConfirmLift(true)}>Lift restriction</button>}
          </div>
          {confirmLift && data.canLift && !row.lifted_at && <div className="border border-amber-300/40 rounded-lg p-3 space-y-2">
            <p className="text-sm">Lift the restriction for {row.full_name}? Other eligibility checks still apply. The reason will be saved in the audit history.</p>
            <button type="button" disabled={busy || !comment.trim()} className={button} onClick={() => mutate({ action: 'lift', id: row.id, comment })}>Confirm lift</button>
            <button type="button" className={`${button} ml-2`} onClick={() => setConfirmLift(false)}>Cancel lift</button>
          </div>}
          {!data.canLift && <p className="text-xs text-neutral-400">Only the owner or authorized managers can lift restrictions. Notes remain in the audit history.</p>}
        </div> : <>
          <label className="block text-sm">Search restricted guests<input className={field} value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Search name" /></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={history} onChange={e => { setHistory(e.target.checked); setPage(0); }} />Include lifted / expired</label>
          {!data ? <p>Loading…</p> : data.rows.length === 0 ? <p className="text-sm text-neutral-400">No restrictions found.</p> : data.rows.map(r => <button type="button" key={r.id} className="w-full text-left p-3 border border-white/15 rounded-xl" onClick={() => { setSelected(r.id); setComment(''); }}>
            <span className="block font-bold">{r.full_name}</span>
            <span className="block text-xs text-amber-200">{r.lifted_at ? 'Lifted' : r.expires_at && Date.parse(r.expires_at) <= Date.now() ? 'Expired' : r.kind === 'banned' ? 'Banned' : r.kind === 'review' ? 'Manager review' : 'Temporary restriction'}</span>
            <span className="block text-sm text-neutral-300 line-clamp-2">{r.reason}</span>
          </button>)}
          <div className="flex gap-2">
            <button className={button} disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button>
            <button className={button} disabled={data?.rows.length !== 50} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
          {data?.isAdmin && <details className="border-t border-white/15 pt-3">
            <summary className="text-sm cursor-pointer">Authorized restriction managers</summary>
            <p className="text-xs text-neutral-400 my-2">Only grant this to staff authorized to restore access. Other staff can still add restrictions and notes.</p>
            {data.staff.map(person => <label key={person.user_id} className="flex gap-2 py-2 text-sm">
              <input type="checkbox" checked={person.authorized} disabled={busy} onChange={e => setConfirmManager({ person, enabled: e.target.checked })} />{person.full_name || 'Staff member'}
            </label>)}
            {confirmManager && <div className="border border-amber-300/40 rounded-lg p-3 space-y-2">
              <p className="text-sm">{confirmManager.enabled ? 'Authorize' : 'Remove authorization for'} {confirmManager.person.full_name} to lift restrictions?</p>
              <button type="button" className={button} disabled={busy} onClick={() => mutate({ action: 'manager', user_id: confirmManager.person.user_id, enabled: confirmManager.enabled })}>Confirm permission change</button>
              <button type="button" className={`${button} ml-2`} onClick={() => setConfirmManager(null)}>Cancel</button>
            </div>}
          </details>}
        </>}
      </div>
    </dialog>}
  </>;
}

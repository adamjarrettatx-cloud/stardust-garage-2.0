'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useDoorScanner } from '../components/useDoorScanner';
import { INCIDENT_ACTIONS, INCIDENT_CATEGORIES } from '@/lib/capacity/security-labels';
import type { IncidentAction, IncidentCategory, SecurityIncident } from '@/lib/capacity/security-incidents';
import StationSessionControls from '@/app/components/StationSessionControls';
import styles from './security.module.css';

type Subject = { kind: 'member' | 'trial_pass' | 'guest'; id: string };
type Guest = {
  subject: Subject;
  profile: { full_name: string; photo_url: string | null };
  access: { status: string; matches: { id: string; kind: string; reason: string; match: string }[]; incidents: SecurityIncident[] };
};
type SearchRow = Subject & { full_name: string; photo_url?: string | null };
type Payload = Record<string, unknown>;
async function request(payload: Payload): Promise<Guest & { ok?: boolean; id?: string }> {
  const res = await fetch('/api/capacity/security', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed. Retry.');
  return data;
}
function date(value: string) { return new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' }); }

function Camera({ onScan, enabled }: { onScan: (raw: string) => void; enabled: boolean }) {
  const scanner = useDoorScanner({ enabled, onRawScan: onScan });
  return <section className={styles.camera} aria-label="Account QR scanner">
    <video ref={scanner.videoRef} autoPlay muted playsInline aria-label="Live camera view" />
    <p>{scanner.phase === 'camera_error' ? scanner.cameraErrorMessage : 'Scan the account QR or Trial Pass'}</p>
    {scanner.phase === 'camera_error' && <p>Use guest search below if the camera is unavailable.</p>}
    {scanner.torchSupported && <button type="button" onClick={scanner.toggleTorch}>{scanner.torch ? 'Turn light off' : 'Turn light on'}</button>}
  </section>;
}

export default function SecurityClient({ staffLabel, stationMode = false }: { staffLabel: string; stationMode?: boolean }) {
  const [guest, setGuest] = useState<Guest | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [category, setCategory] = useState<IncidentCategory>('photography');
  const [action, setAction] = useState<IncidentAction>('warning');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [photoFailed, setPhotoFailed] = useState(false);
  const [eventLabel, setEventLabel] = useState('Checking active event…');
  const [refreshNeeded, setRefreshNeeded] = useState(false);
  const lock = useRef(false);
  const requestId = useRef<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const abortSearch = useRef<AbortController | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch('/api/door-session/active', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error();
        if (alive) setEventLabel(data.session?.event?.title || 'No active event. Incident will still be recorded.');
      } catch { if (alive) setEventLabel('Event display unavailable. Event is resolved when saving.'); }
    };
    load(); const timer = setInterval(load, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const lookup = useCallback(async (payload: Payload) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    abortSearch.current?.abort();
    try {
      const data = await request({ action: 'lookup', ...payload });
      setGuest(data); setConfirmed(false); setNote(''); setPhotoFailed(false); setQuery(''); setResults([]);
      setAction('warning'); setCategory('photography'); requestId.current = null; setRefreshNeeded(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not look up guest.'); }
    finally { lock.current = false; setBusy(false); }
  }, []);
  const scan = useCallback((raw: string) => { void lookup({ raw }); }, [lookup]);
  useEffect(() => {
    const controller = new AbortController(); abortSearch.current = controller;
    setResults([]); setSearching(false);
    if (guest || query.trim().length < 2) return () => controller.abort();
    const timer = setTimeout(async () => {
      setSearching(true); setError('');
      try {
        const res = await fetch(`${stationMode ? '/api/station/guest-search' : '/api/team/trial-pass/today'}?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal, cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Search unavailable.');
        if (!controller.signal.aborted) setResults(data.signins || []);
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Search unavailable.'); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 300);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [query, guest, stationMode]);
  function changed() { requestId.current = null; setMessage(''); }
  async function save(restrictionConfirmed = false) {
    if (!guest || lock.current || refreshNeeded) return;
    if (!confirmed || !note.trim()) { setError('Confirm the guest and enter a factual note.'); return; }
    lock.current = true; setBusy(true); setError(''); setMessage('');
    requestId.current ||= crypto.randomUUID();
    try {
      await request({ action: 'record', subject: guest.subject, request_id: requestId.current,
        incident_action: action, category, note, identity_confirmed: confirmed, restriction_confirmed: restrictionConfirmed });
      setMessage(action === 'ban' ? 'Ban saved. Future entry is blocked.' : action === 'review' ? 'Review restriction saved. Hold future entry.' : 'Warning saved. Front-desk staff will see it at admission.');
      requestId.current = null; setNote(''); setConfirmed(false); setRefreshNeeded(true);
      try { setGuest(await request({ action: 'lookup', subject: guest.subject })); setRefreshNeeded(false); }
      catch { setError('Saved successfully, but history could not refresh. Reload this guest before recording another incident.'); }
    } catch (err) { setError(err instanceof Error ? err.message : 'Save not confirmed. Retry.'); }
    finally { lock.current = false; setBusy(false); }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    if (action === 'ban' || action === 'review') dialog.current?.showModal();
    else void save();
  }
  function nextGuest() { if (lock.current) return; setGuest(null); setError(''); setMessage(''); setQuery(''); setResults([]); requestId.current = null; }

  return <main className={styles.page}>
    <header className={styles.header}>{stationMode ? <StationSessionControls /> : <Link href="/capacity/front-desk">Front desk</Link>}<span>Stardust Garage</span></header>
    <section className={styles.card}>
      <div className={styles.heading}><div className={styles.eyebrow}>Team / Security</div><h1>Guest incident</h1><p>{staffLabel}</p><p>{eventLabel}</p></div>
      <div className={styles.body}>
        {message && <p className={styles.success} role="status">{message}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {!guest ? <>
          <Camera onScan={scan} enabled={!busy} />
          {busy && <p role="status">Looking up guest…</p>}
          <label>Guest search<input maxLength={120} value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, at least 2 characters" disabled={busy} /></label>
          <p className={styles.muted}>Use this if the guest cannot show a QR. Verify their identity before recording an incident. Ticket QRs identify the buyer, so they are not accepted here.</p>
          {searching && <p role="status">Searching…</p>}
          {!searching && query.trim().length >= 2 && !results.length && !error && <p>No matching guests.</p>}
          {results.map(row => <button className={styles.searchRow} key={`${row.kind}:${row.id}`} disabled={busy} onClick={() => lookup({ subject: { kind: row.kind, id: row.id } })}>
            <span>{row.full_name}<small>{row.kind.replace('_', ' ')} · {row.id.slice(-6)}</small></span><span>View</span>
          </button>)}
        </> : <>
          <div className={styles.between}><span className={styles.eyebrow}>Account identified</span><button disabled={busy} onClick={nextGuest}>Next guest</button></div>
          <div className={styles.profile}>
            <div className={styles.photo}>{guest.profile.photo_url && !photoFailed
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={guest.profile.photo_url} alt="Guest profile photo" onError={() => setPhotoFailed(true)} />
              : <span>No photo<br />Verify ID</span>}</div>
            <div><h2>{guest.profile.full_name}</h2><p className={styles.muted}>Account · {guest.subject.id.slice(-6)}</p></div>
          </div>
          {guest.access.matches.map(row => <div key={row.id} className={styles.dangerBox}>
            <strong>{row.match === 'possible' ? 'Possible restriction: verify identity' : row.kind === 'banned' ? 'DO NOT ADMIT' : 'ENTRY RESTRICTED'}</strong><p>{row.reason}</p>
          </div>)}
          {guest.access.incidents[0] && <div className={['ban', 'review'].includes(guest.access.incidents[0].action) ? styles.dangerBox : styles.warningBox}><strong>Latest incident · {INCIDENT_ACTIONS[guest.access.incidents[0].action]}</strong>
            <p>{guest.access.incidents[0].note}</p><small>{date(guest.access.incidents[0].created_at)} · {guest.access.incidents[0].actor_label}</small></div>}
          {refreshNeeded ? <button onClick={() => lookup({ subject: guest.subject })} disabled={busy}>Reload guest history</button> : <form onSubmit={submit} className={styles.form}>
            <fieldset disabled={busy}>
              <label className={styles.checkbox}><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I confirmed this is the correct guest.</label>
              <label>Rule / incident<select value={category} onChange={e => { setCategory(e.target.value as IncidentCategory); changed(); }}>{Object.entries(INCIDENT_CATEGORIES).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
              <label>What happened?<textarea maxLength={1500} required value={note} onChange={e => { setNote(e.target.value); changed(); }} placeholder="Record what you observed and what you told the guest." /></label>
              <label>Action<select value={action} onChange={e => { setAction(e.target.value as IncidentAction); changed(); }}>{Object.entries(INCIDENT_ACTIONS).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
              <p className={styles.muted}>{action === 'ban' ? 'Blocks entry immediately until an authorized manager lifts it. No prior manager approval required.' : action === 'review' ? 'Hold future admission until an authorized manager lifts the review restriction.' : 'A warning does not ban this guest. Staff must record a rule reminder before admission.'}</p>
              <button type="submit" className={action === 'ban' ? styles.dangerButton : styles.primary} disabled={busy || !confirmed || !note.trim()}>{busy ? 'Saving…' : action === 'ban' ? 'Ban immediately' : action === 'review' ? 'Require manager review' : 'Save warning'}</button>
            </fieldset>
          </form>}
          <p className={styles.muted}>Staff-only. Records your name, event and time. Only Adam, Naish and Jeyu can lift restrictions.</p>
          <details><summary>Incident history ({guest.access.incidents.length})</summary>
            {guest.access.incidents.length === 0 && <p>No recorded incidents.</p>}
            {guest.access.incidents.map(row => <article key={row.id} className={styles.history}><strong>{INCIDENT_ACTIONS[row.action]} · {INCIDENT_CATEGORIES[row.category]}</strong><p>{row.note}</p><small>{date(row.created_at)} · {row.actor_label}</small></article>)}
          </details>
        </>}
      </div>
    </section>
    <dialog ref={dialog} className={styles.dialog}>
      <h2>{action === 'ban' ? 'Ban' : 'Restrict'} {guest?.profile.full_name}?</h2>
      <p>{action === 'ban' ? 'This immediately blocks future entry, even with a valid ticket or membership.' : 'Future admission will be held for manager review.'} Only Adam, Naish and Jeyu can lift the restriction.</p>
      <div className={styles.between}><button onClick={() => dialog.current?.close()}>Cancel</button><button className={styles.dangerButton} onClick={() => { dialog.current?.close(); void save(true); }}>Confirm {action === 'ban' ? 'ban' : 'restriction'}</button></div>
    </dialog>
  </main>;
}

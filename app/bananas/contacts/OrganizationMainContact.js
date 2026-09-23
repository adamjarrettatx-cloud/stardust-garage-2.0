'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './profile.module.css';

export default function OrganizationMainContact({ contactId, legacyName, isAdmin, disabled }) {
  const uid = useId();
  const router = useRouter();
  const [record, setRecord] = useState(null);
  const [mode, setMode] = useState(null);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState({ name: '', email: '', phone: '' });
  const endpoint = `/api/admin/contacts/${contactId}/main-contact`;
  async function load(signal) {
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load the main contact.');
      setRecord(data); setError('');
    } catch (err) { if (err.name !== 'AbortError') setError(err.message); }
  }
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
    // Each organization has its own independent request and relationship.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);
  async function search(event) {
    event.preventDefault(); setSearching(true); setError(''); setSearched(false);
    try {
      const response = await fetch(`${endpoint}?q=${encodeURIComponent(query.trim())}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not search people.');
      setCandidates(data.candidates); setSearched(true);
    } catch (err) { setError(err.message); } finally { setSearching(false); }
  }
  async function save(action, candidate) {
    if (!record || busy || disabled) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoint, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: action, id: candidate?.id, person: draft, expectedVersion: record.version }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save the main contact.');
      setRecord(data); setMode(null); setCandidates([]); setSearched(false);
      setDraft({ name: '', email: '', phone: '' });
      setMessage(action === 'clear' ? 'Main contact removed. Their profile is unchanged.' : 'Main point of contact saved.');
      router.refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const person = record?.person;
  const blocked = disabled || busy || !record;
  const profileHref = person?.source === 'contact' ? `/bananas/contacts/${person.id}`
    : isAdmin && person?.member_id ? `/bananas/members/${person.member_id}` : null;
  return <section className={`${styles.card} ${styles.organizationContact}`} aria-labelledby={`${uid}-heading`}>
    <div className={styles.cardHeading}><h2 id={`${uid}-heading`}>Main point of contact</h2><span>Linked person</span></div>
    <div className={styles.cardBody}>
      <p className={styles.hint}>The person to reach about this organization. Linking them does not grant portal access or signing authority.</p>
      {!record && !error && <p role="status">Loading main contact…</p>}
      {person ? <div className={styles.mainContactSummary}>
        <div><h3>{person.name}</h3><p>{[person.email, person.phone].filter(Boolean).join(' · ') || 'No email or phone on file'}</p>
          <p className={styles.hint}>{person.source === 'account' ? 'Existing account' : 'Contact profile'}{person.status !== 'active' ? ` · ${person.status}` : ''}</p></div>
        {profileHref && <Link className={styles.textButton} href={profileHref}>Open profile →</Link>}
      </div> : record && <p>No main contact linked yet.{legacyName && <> Previously recorded name: <strong>{legacyName}</strong>. Select their profile to link it.</>}</p>}
      {disabled && <p className={styles.hint}>Save or discard profile edits first. Archived organizations must be restored before changing this link.</p>}
      {error && <div role="alert" className={styles.error}>{error} <button type="button" className={styles.textButton} disabled={busy} onClick={() => load()}>Reload current contact</button></div>}
      {message && <p role="status" className={styles.success}>{message}</p>}
      {!mode ? <div className={styles.contactActions}>
        <button type="button" className={`${styles.button} ${styles.primaryButton}`} disabled={blocked}
          onClick={() => { setMode('search'); setError(''); setMessage(''); }}> {person ? 'Change main contact' : 'Select existing person'}</button>
        <button type="button" className={styles.button} disabled={blocked}
          onClick={() => { setMode('create'); setError(''); setMessage(''); }}>Create new person</button>
        {person && <button type="button" className={styles.textButton} disabled={blocked}
          onClick={() => { if (window.confirm('Remove this main-contact link? The person’s profile will not be deleted.')) save('clear'); }}>Remove link</button>}
      </div> : <fieldset disabled={blocked || searching} className={styles.editable}>
        {mode === 'search' ? <form onSubmit={search}>
          <label className={styles.fieldLabel} htmlFor={`${uid}-search`}>Search Contacts and all accounts</label>
          <div className={styles.contactSearch}><input id={`${uid}-search`} type="search" required minLength={2} maxLength={120}
            placeholder="Name, email or phone" value={query} onChange={(event) => { setQuery(event.target.value); setSearched(false); setCandidates([]); }} />
            <button className={styles.button} type="submit">{searching ? 'Searching…' : 'Search'}</button></div>
          {searched && !candidates.length && <p role="status">No matching people. Try another search or create a new person.</p>}
          <div className={styles.contactCandidates}>{candidates.map((candidate) => <button type="button" className={styles.contactCandidate}
            key={`${candidate.source}:${candidate.id}`} onClick={() => save(candidate.source, candidate)}>
            <span><strong>{candidate.name}</strong><span>{candidate.email || candidate.phone || 'No contact details'}</span></span>
            <span>{candidate.source === 'account' ? 'Account' : 'Contact'} · Select</span>
          </button>)}</div>
          {candidates.length === 50 && <p className={styles.hint}>Showing 50 matches. Refine your search to find the right person.</p>}
        </form> : <form onSubmit={(event) => { event.preventDefault(); save('create'); }}>
          <h3>Create a person contact</h3><p className={styles.hint}>Creates and links a contact here. No login account or invitation is created.</p>
          <div className={styles.fields}>{[
            ['name', 'Full name', 'text', 200], ['email', 'Email address', 'email', 254], ['phone', 'Phone number', 'tel', 50],
          ].map(([key, label, type, max]) => <div className={styles.field} key={key}><label htmlFor={`${uid}-${key}`}>{label}</label>
            <input id={`${uid}-${key}`} required={key === 'name'} maxLength={max} type={type} value={draft[key]}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></div>)}</div>
          <button type="submit" className={`${styles.button} ${styles.primaryButton}`}>{busy ? 'Saving…' : 'Create and link person'}</button>
        </form>}
        <div className={styles.contactActions}><button type="button" className={styles.textButton}
          onClick={() => { setMode(mode === 'search' ? 'create' : 'search'); setError(''); }}>{mode === 'search' ? 'Create new person instead' : 'Search existing people instead'}</button>
          <button type="button" className={styles.textButton} onClick={() => { setMode(null); setError(''); }}>Cancel</button></div>
      </fieldset>}
    </div>
  </section>;
}

'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import styles from './profile.module.css';

// Additional people at an organization. Each one is a real Person profile in
// Contacts, linked here with a role. Linking grants no login, portal access,
// or signing authority.
export default function OrganizationPeople({ contactId, disabled }) {
  const uid = useId();
  const endpoint = `/api/admin/contacts/${contactId}/people`;
  const [people, setPeople] = useState(null);
  const [mode, setMode] = useState(null);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [role, setRole] = useState('');
  const [draft, setDraft] = useState({ name: '', email: '', phone: '' });
  const [editing, setEditing] = useState(null);
  const [roleDraft, setRoleDraft] = useState('');

  async function load(signal) {
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load people.');
      setPeople(data.people); setError('');
    } catch (err) { if (err.name !== 'AbortError') setError(err.message); }
  }
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  const reset = () => {
    setMode(null); setQuery(''); setCandidates([]); setSearched(false);
    setRole(''); setDraft({ name: '', email: '', phone: '' }); setError('');
  };
  async function send(method, body, done) {
    if (busy || disabled) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoint, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save this change.');
      setPeople(data.people); done?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function search(event) {
    event.preventDefault(); setSearching(true); setError(''); setSearched(false);
    try {
      const response = await fetch(`${endpoint}?q=${encodeURIComponent(query.trim())}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not search people.');
      setCandidates(data.candidates); setSearched(true);
    } catch (err) { setError(err.message); } finally { setSearching(false); }
  }
  const add = (body, label) => send('POST', { ...body, role }, () => { reset(); setMessage(`${label} added and linked.`); });

  const roleField = <div className={styles.field}><label htmlFor={`${uid}-role`}>Role at this organization</label>
    <input id={`${uid}-role`} maxLength={100} placeholder="e.g. Founder, Booker, Manager" value={role}
      onChange={(event) => setRole(event.target.value)} /></div>;
  const linkedIds = new Set((people || []).map((p) => p.id));
  const blocked = disabled || busy || !people;
  return <section className={`${styles.card} ${styles.organizationContact}`} aria-labelledby={`${uid}-heading`}>
    <div className={styles.cardHeading}><h2 id={`${uid}-heading`}>Additional contacts</h2><span>Linked people</span></div>
    <div className={styles.cardBody}>
      <p className={styles.hint}>Other people associated with this organization. Each person has their own profile under Persons. Linking does not grant portal access or signing authority.</p>
      {!people && !error && <p role="status">Loading people…</p>}
      {people && people.length === 0 && <p>No additional contacts yet.</p>}
      {people && people.length > 0 && <ul className={styles.peopleList}>{people.map((person) => <li key={person.link_id} className={styles.peopleItem}>
        <div className={styles.peopleText}>
          <h3>{person.name}{person.role && <span className={styles.peopleRole}> · {person.role}</span>}</h3>
          <p>{[person.email, person.phone].filter(Boolean).join(' · ') || 'No email or phone on file'}{person.status !== 'active' ? ` · ${person.status === 'do_not_book' ? 'Do Not Book' : person.status}` : ''}</p>
          {editing === person.link_id && <form className={styles.contactSearch} onSubmit={(event) => {
            event.preventDefault();
            send('PATCH', { linkId: person.link_id, role: roleDraft }, () => { setEditing(null); setMessage('Role updated.'); });
          }}>
            <label className={styles.srOnly} htmlFor={`${uid}-role-${person.link_id}`}>Role for {person.name}</label>
            <input id={`${uid}-role-${person.link_id}`} maxLength={100} placeholder="Role" value={roleDraft} disabled={blocked}
              onChange={(event) => setRoleDraft(event.target.value)} />
            <button className={styles.button} type="submit" disabled={blocked}>{busy ? 'Saving…' : 'Save role'}</button>
            <button className={styles.textButton} type="button" onClick={() => setEditing(null)}>Cancel</button>
          </form>}
        </div>
        <div className={styles.peopleActions}>
          <Link className={styles.textButton} href={`/bananas/contacts/${person.id}`}>Open profile →</Link>
          {editing !== person.link_id && <button type="button" className={styles.textButton} disabled={blocked}
            onClick={() => { setEditing(person.link_id); setRoleDraft(person.role || ''); setMessage(''); }}>Edit role</button>}
          <button type="button" className={`${styles.textButton} ${styles.danger}`} disabled={blocked}
            onClick={() => { if (window.confirm(`Remove ${person.name} from this organization? Their profile under Persons will not be deleted.`)) send('DELETE', { linkId: person.link_id }, () => setMessage(`${person.name} removed. Their profile is unchanged.`)); }}>
            Remove<span className={styles.srOnly}> {person.name}</span></button>
        </div>
      </li>)}</ul>}
      {disabled && <p className={styles.hint}>Save or discard profile edits first. Archived organizations must be restored before changing people.</p>}
      {error && <div role="alert" className={styles.error}>{error} {!people && <button type="button" className={styles.textButton} onClick={() => load()}>Retry</button>}</div>}
      {message && <p role="status" className={styles.success}>{message}</p>}
      {!mode ? <div className={styles.contactActions}>
        <button type="button" className={`${styles.button} ${styles.primaryButton}`} disabled={blocked}
          onClick={() => { setMode('search'); setError(''); setMessage(''); }}>Add existing person</button>
        <button type="button" className={styles.button} disabled={blocked}
          onClick={() => { setMode('create'); setError(''); setMessage(''); }}>Create new person</button>
      </div> : <fieldset disabled={blocked || searching} className={styles.editable}>
        {mode === 'search' ? <form onSubmit={search} className={styles.peopleForm}>
          <h3>Add an existing person</h3>
          {roleField}
          <div><label className={styles.fieldLabel} htmlFor={`${uid}-search`}>Search Contacts and all accounts</label>
          <div className={styles.contactSearch}><input id={`${uid}-search`} type="search" required minLength={2} maxLength={120}
            placeholder="Name, email or phone" value={query} onChange={(event) => { setQuery(event.target.value); setSearched(false); setCandidates([]); }} />
            <button className={styles.button} type="submit">{searching ? 'Searching…' : 'Search'}</button></div></div>
          {searched && !candidates.length && <p role="status">No matching people. Try another search or create a new person.</p>}
          <div className={styles.contactCandidates}>{candidates.map((candidate) => {
            const already = candidate.source === 'contact' && linkedIds.has(candidate.id);
            return <button type="button" className={styles.contactCandidate} disabled={already}
              key={`${candidate.source}:${candidate.id}`} onClick={() => add({ mode: candidate.source, id: candidate.id }, candidate.name)}>
              <span><strong>{candidate.name}</strong><span>{candidate.email || candidate.phone || 'No contact details'}</span></span>
              <span>{already ? 'Already linked' : `${candidate.source === 'account' ? 'Account' : 'Contact'} · Add`}</span>
            </button>;
          })}</div>
          {candidates.some((c) => c.source === 'account') && <p className={styles.hint}>Choosing an account creates or reuses a matching profile under Persons. It does not change the account.</p>}
        </form> : <form className={styles.peopleForm} onSubmit={(event) => { event.preventDefault(); add({ mode: 'create', person: draft }, draft.name.trim() || 'Person'); }}>
          <div><h3>Create a person contact</h3><p className={styles.hint}>Creates a profile under Persons and links it here. If a person with the same name and email already exists, that profile is linked instead. No login account or invitation is created.</p></div>
          <div className={styles.fields}>{[
            ['name', 'Full name', 'text', 200], ['email', 'Email address', 'email', 254], ['phone', 'Phone number', 'tel', 50],
          ].map(([key, label, type, max]) => <div className={styles.field} key={key}><label htmlFor={`${uid}-${key}`}>{label}</label>
            <input id={`${uid}-${key}`} required={key === 'name'} maxLength={max} type={type} value={draft[key]}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></div>)}{roleField}</div>
          <div><button type="submit" className={`${styles.button} ${styles.primaryButton}`}>{busy ? 'Saving…' : 'Create and link person'}</button></div>
        </form>}
        <div className={styles.contactActions}><button type="button" className={styles.textButton}
          onClick={() => { setMode(mode === 'search' ? 'create' : 'search'); setError(''); }}>{mode === 'search' ? 'Create new person instead' : 'Search existing people instead'}</button>
          <button type="button" className={styles.textButton} onClick={reset}>Cancel</button></div>
      </fieldset>}
    </div>
  </section>;
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { validateLegalName } from '@/lib/legal-name';

export default function PersonalDetails({ profile, initialEditing = false }) {
  const router = useRouter();
  const [editing, setEditing] = useState(initialEditing);
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  function open() { setName(profile.name); setPhone(profile.phone); setError(''); setSaved(false); setEditing(true); }
  function close() { setEditing(false); }
  async function save(event) {
    event.preventDefault(); setError(''); setSaved(false);
    const legalName = validateLegalName(name);
    if (!legalName.valid) { setError(legalName.error); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/account/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: name, phone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save your details.');
      close(); setSaved(true); router.refresh();
    } catch (failure) { setError(failure.message || 'Could not save your details. Please try again.'); }
    finally { setBusy(false); }
  }
  return <section className="account-hub-panel" aria-label="Contact details">
    <div className="account-hub-panel-heading"><h3>Contact details</h3>{!editing && <button className="account-hub-text-button" type="button" onClick={open}>Edit</button>}</div>
    {editing ? <form className="account-hub-form" onSubmit={save}>
      <label htmlFor="profile-name">Full name<input id="profile-name" autoFocus autoComplete="name" maxLength={120} required value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label>
      <label htmlFor="profile-phone">Phone<input id="profile-phone" type="tel" autoComplete="tel" maxLength={32} value={phone} onChange={(event) => setPhone(event.target.value)} disabled={busy} /></label>
      <p className="account-hub-note">Changing your phone number clears its previous verification. Your login email is unchanged.</p>
      {error && <p className="account-hub-error" role="alert">{error}</p>}
      <div className="account-hub-actions"><button className="account-hub-button" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button><button className="account-hub-button secondary" type="button" disabled={busy} onClick={close}>Cancel</button></div>
    </form> : <dl className="account-hub-details">
      <div className="account-hub-row"><dt>Full name</dt><dd>{profile.name || 'Not added'}</dd><button className="account-hub-text-button" type="button" aria-label="Edit full name" onClick={open}>Edit</button></div>
      <div className="account-hub-row"><dt>Email</dt><dd>{profile.email}<small>Used to sign in and receive account updates.</small></dd></div>
      <div className="account-hub-row"><dt>Phone</dt><dd>{profile.phone || 'Not added'}{profile.phoneVerified && <small>Verified</small>}</dd><button className="account-hub-text-button" type="button" aria-label="Edit phone" onClick={open}>Edit</button></div>
    </dl>}
    {saved && <p role="status" className="account-hub-success">Your contact details have been saved.</p>}
  </section>;
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { uploadPartnerPhoto, validatePhotoFile } from '@/lib/partner-photo';

export default function ProfileClient({ profile }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile.fullName);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!photo) { setPreview(''); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  function edit() { setName(profile.fullName); setPhoto(null); setError(''); setSaved(false); setEditing(true); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      let photoPath;
      if (photo) {
        const upload = await uploadPartnerPhoto(createClient(), photo);
        if (upload.error) throw new Error(upload.error);
        photoPath = upload.path;
      }
      const response = await fetch('/api/portal/profile', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: name.trim(), ...(photoPath ? { photoPath } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not save partner details.');
      setEditing(false); setPhoto(null); setSaved(true); router.refresh();
    } catch (failure) { setError(failure.message || 'Could not save partner details. Please try again.'); }
    finally { setBusy(false); }
  }
  return <section className="account-hub-panel" aria-label="Partner details">
    <div className="account-hub-panel-heading"><h3>Partner details</h3>{!editing && <button className="account-hub-text-button" type="button" onClick={edit}>Edit partner details</button>}</div>
    {editing ? <form className="account-hub-form" onSubmit={save}>
      <label htmlFor="partner-name">Name on partner record<input id="partner-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} autoFocus disabled={busy} /></label>
      <label htmlFor="partner-photo">Partner identification photo<input id="partner-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => {
        const file = event.target.files?.[0];
        const invalid = file ? validatePhotoFile(file) : null;
        setError(invalid || ''); setPhoto(invalid ? null : file || null);
      }} /></label>
      {/* A local blob preview must not go through the remote image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {preview && <img src={preview} alt="Selected partner identification photo" width={88} height={88} style={{ objectFit: 'cover', borderRadius: 8 }} />}
      <p className="account-hub-note">Used for your partner bookings and door identification. This record is separate from your personal ticket photo. Leave the photo unchanged to keep the one already on file.</p>
      {error && <p role="alert" className="account-hub-error">{error}</p>}
      <div className="account-hub-actions"><button className="account-hub-button" disabled={busy}>{busy ? 'Saving…' : 'Save partner details'}</button><button type="button" className="account-hub-button secondary" disabled={busy} onClick={() => { setEditing(false); setPhoto(null); }}>Cancel</button></div>
    </form> : <dl className="account-hub-details">
      <div className="account-hub-row"><dt>Partner name</dt><dd>{profile.fullName || 'Not added'}</dd></div>
      <div className="account-hub-row"><dt>Organization / act</dt><dd>{profile.contactDisplayName || 'Not assigned'}<small>Contact Stardust to update your organization or relationship type.</small></dd></div>
    </dl>}
    {saved && <p role="status" className="account-hub-success">Partner details saved.</p>}
  </section>;
}

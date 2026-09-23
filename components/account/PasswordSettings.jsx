'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function PasswordSettings() {
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function save(event) {
    event.preventDefault(); setError(''); setSaved(false);
    if (password.length < 8 || password !== confirmation || password === current) {
      setError('Use at least 8 characters, match both new-password fields, and choose a different password.'); return;
    }
    setBusy(true);
    try {
      const client = createClient();
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (userError || !user?.email) throw new Error('Please sign in again.');
      const { error: verifyError } = await client.auth.signInWithPassword({ email: user.email, password: current });
      if (verifyError) throw new Error('Your current password could not be verified.');
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);
      setCurrent(''); setPassword(''); setConfirmation(''); setSaved(true);
    } catch (failure) { setError(failure.message || 'Could not update your password. Please try again.'); }
    finally { setBusy(false); }
  }
  return <section className="account-hub-panel">
    <div className="account-hub-panel-heading"><h3>Change password</h3></div>
    <form onSubmit={save} className="account-hub-form">
      <p className="account-hub-note" style={{ marginBottom: 20 }}>For accounts with a password. If you use Google or Apple to sign in, manage your password with that provider.</p>
      <label htmlFor="current-password">Current password<input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} required disabled={busy} /></label>
      <label htmlFor="new-password">New password<input id="new-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} /></label>
      <label htmlFor="confirm-password">Confirm new password<input id="confirm-password" type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required disabled={busy} /></label>
      {error && <p role="alert" className="account-hub-error">{error}</p>}
      {saved && <p role="status">Your password has been updated.</p>}
      <button className="account-hub-button" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button>
    </form>
  </section>;
}

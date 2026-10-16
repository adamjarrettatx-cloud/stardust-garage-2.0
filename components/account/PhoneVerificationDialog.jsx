'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { formatPhone, normalizeStoredPhone, usPhoneDigits } from '@/lib/phone';
import { validateLegalName } from '@/lib/legal-name';

// Verifies the signed-in account's mobile number from the profile header.
// Uses the same Twilio Verify routes as the app: start sends the code, and
// complete-profile confirms it against the bearer session's own user id.
export default function PhoneVerificationDialog({ profile, onClose }) {
  const router = useRouter();
  const dialog = useRef(null);
  const pending = useRef(false);
  const [phone, setPhone] = useState(formatPhone(profile.phone));
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!cooldown) return undefined;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function bearer() {
    const { data } = await createClient().auth.getSession();
    const token = data?.session?.access_token;
    if (!token) throw new Error('Your session expired. Please sign in again.');
    return token;
  }

  async function send(event) {
    event?.preventDefault();
    if (pending.current || cooldown) return;
    const normalized = usPhoneDigits(phone) ? normalizeStoredPhone(phone) : '';
    if (!normalized) { setError('Enter a valid US mobile number.'); return; }
    if (!validateLegalName(profile.name).valid) { setError('Save your legal first and last name in Edit Profile first.'); return; }
    if (!profile.email) { setError('Please sign in again.'); return; }
    pending.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/free-account/verify/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: profile.name, phone: normalized, email: profile.email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not send a verification code.');
      setSentTo(normalized); setCode(''); setCooldown(30);
    } catch (failure) { setError(failure.message || 'Could not send a verification code.'); }
    finally { pending.current = false; setBusy(false); }
  }

  async function verify(event) {
    event.preventDefault();
    if (pending.current || !sentTo) return;
    if (!/^\d{6}$/.test(code.trim())) { setError('Enter the 6-digit code from your text message.'); return; }
    pending.current = true; setBusy(true); setError('');
    try {
      const token = await bearer();
      const response = await fetch('/api/free-account/complete-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fullName: profile.name, phone: sentTo, code: code.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Your phone could not be verified.');
      dialog.current?.close();
      router.refresh();
    } catch (failure) { setError(failure.message || 'Your phone could not be verified.'); }
    finally { pending.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} className="account-hub-dialog" aria-labelledby="verify-phone-title"
    onClose={onClose} onCancel={(event) => { if (busy) event.preventDefault(); }}>
    <div className="account-hub-panel-heading"><h2 id="verify-phone-title">Verify phone</h2>
      <button type="button" className="account-hub-text-button" disabled={busy} onClick={() => dialog.current?.close()}>Close</button></div>
    {sentTo ? <form className="account-hub-form" onSubmit={verify}>
      <p className="account-hub-note">Enter the code sent to {formatPhone(sentTo)}.</p>
      <label htmlFor="verify-phone-code">Verification code<input id="verify-phone-code" autoFocus inputMode="numeric"
        autoComplete="one-time-code" maxLength={6} value={code} disabled={busy}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} /></label>
      {error && <p className="account-hub-error" role="alert">{error}</p>}
      <div className="account-hub-actions">
        <button className="account-hub-button" disabled={busy}>{busy ? 'Verifying…' : 'Verify number'}</button>
        <button className="account-hub-button secondary" type="button" disabled={busy || cooldown > 0} onClick={() => send()}>
          {cooldown ? `Resend in ${cooldown}s` : 'Resend code'}</button>
        <button className="account-hub-button secondary" type="button" disabled={busy}
          onClick={() => { setSentTo(null); setCode(''); setError(''); }}>Change number</button>
      </div>
    </form> : <form className="account-hub-form" onSubmit={send}>
      <p className="account-hub-note">We’ll text you a code to verify your mobile number.</p>
      <label htmlFor="verify-phone-number">Mobile number<input id="verify-phone-number" autoFocus type="tel"
        autoComplete="tel" maxLength={32} value={phone} disabled={busy}
        onChange={(event) => setPhone(event.target.value)} onBlur={() => setPhone(formatPhone(phone))} /></label>
      {error && <p className="account-hub-error" role="alert">{error}</p>}
      <div className="account-hub-actions">
        <button className="account-hub-button" disabled={busy || cooldown > 0}>{busy ? 'Sending…' : 'Send code'}</button>
      </div>
    </form>}
  </dialog>;
}

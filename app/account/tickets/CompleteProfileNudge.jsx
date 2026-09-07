'use client';

// CompleteProfileNudge.jsx
//
// Small inline form shown at the top of /account/tickets when the signed-in
// user has no free_accounts row yet (or the row exists but the phone column
// is blank). This is the Google-OAuth escape hatch: Google gave us an email
// but never a phone number, so the ticket wallet asks for it on first visit.
//
// Posts to /api/free-account/complete-profile-no-verify, which stamps the
// name + phone against the caller's auth.users id (bearer token). On success
// the nudge fades out and the parent page reloads to pick up the new row.

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function CompleteProfileNudge({ initialName = '', initialPhone = '' }) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Not signed in.');
      const res = await fetch('/api/free-account/complete-profile-no-verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fullName: name, phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not save profile.');
      setDone(true);
      // Refresh the server component so the nudge disappears + the wallet
      // picks up the new free_accounts row.
      setTimeout(() => { window.location.reload(); }, 600);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  if (done) return null;

  return (
    <form
      onSubmit={onSubmit}
      style={{
        background: '#141414',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: 16,
        marginBottom: 18,
      }}
    >
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
        color: '#8a8a8a', textTransform: 'uppercase', marginBottom: 6,
      }}>
        Complete your profile
      </div>
      <div style={{ fontSize: 13, color: '#a0a0a0', marginBottom: 12 }}>
        Add your name and mobile so we can reach you about your tickets.
      </div>
      <div className="grid gap-2.5 md:grid-cols-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full legal name"
          required
          autoComplete="name"
          className="w-full px-4 py-3 rounded-full outline-none border transition-colors focus:border-white/30"
          style={{ background: '#0a0a0a', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f5f5', fontSize: 16 }}
        />
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 555 555 5555"
          required
          autoComplete="tel"
          className="w-full px-4 py-3 rounded-full outline-none border transition-colors focus:border-white/30"
          style={{ background: '#0a0a0a', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f5f5', fontSize: 16 }}
        />
      </div>
      {error && (
        <div className="text-[13px] text-red-400" style={{ marginTop: 10 }}>{error}</div>
      )}
      <button
        type="submit"
        disabled={busy}
        style={{
          marginTop: 12,
          padding: '10px 18px', borderRadius: 999,
          background: '#ffffff', color: '#0a0a0a',
          border: 'none',
          fontSize: 12, fontWeight: 700, letterSpacing: '0.14em',
          cursor: 'pointer', opacity: busy ? 0.5 : 1,
        }}
      >
        {busy ? 'SAVING\u2026' : 'SAVE PROFILE'}
      </button>
    </form>
  );
}

'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// The two ways into a partner account, in the order partners should reach for
// them: Google, then the emailed link.
//
// Google is primary because partners are promoters and collectives who signed
// up months before the night they actually need the guest list — by then the
// single-use invite link in their inbox is long expired, and "send me another
// one" was a support request every time. The magic link stays as the backup for
// partners whose contact email isn't a Google account.
//
// Rendered both on /portal/login (returning partners) and on /portal/activate
// when the invite link has expired, so an invitee who clicks a dead link can
// get themselves in without asking us.

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.93v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.93a9 9 0 0 0 0 8.1l3.04-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .93 4.95l3.04 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

export default function PortalSignIn() {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleGoogle = async () => {
    setError('');
    setStarting(true);

    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/portal/auth/callback` },
    });

    // On success the browser is already navigating to Google, so this only
    // runs when the provider is unreachable or not enabled on the project.
    if (oauthError) {
      setStarting(false);
      setError(
        oauthError.message?.includes('not enabled')
          ? 'Google sign-in is not switched on yet. Use the email link below.'
          : 'Could not start Google sign-in. Please try again.'
      );
    }
  };

  const handleEmailLink = async (e) => {
    e.preventDefault();
    setError('');
    setSending(true);

    const res = await fetch('/api/portal/request-signin-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim() }),
    });

    setSending(false);
    if (!res.ok) {
      setError('Could not send that link. Please try again.');
      return;
    }
    // Deliberately the same message whether or not the address has an invite —
    // this endpoint is public and must not confirm who we work with.
    setSent(true);
  };

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={handleGoogle}
        disabled={starting}
        className="w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] flex items-center justify-center gap-3 transition-all hover:-translate-y-0.5 disabled:opacity-50"
        style={{ background: '#ffffff', color: '#0a0a0a' }}
      >
        <GoogleMark />
        {starting ? 'REDIRECTING...' : 'SIGN IN WITH GOOGLE'}
      </button>

      {error && <div className="text-[13px] text-red-400 text-center">{error}</div>}

      {sent ? (
        <p className="text-[13px] leading-[1.6] text-center" style={{ color: '#a0a0a0' }}>
          If that address has a partner invite, a sign-in link is on its way. It works once and
          then expires.
        </p>
      ) : showEmail ? (
        <form onSubmit={handleEmailLink} className="space-y-3">
          <label className="block text-[12px] font-semibold tracking-[0.14em]" style={{ color: '#8a8a8a' }}>
            EMAIL
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            placeholder="the address we invited"
            className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30"
            style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f5f5' }}
          />
          <button
            type="submit"
            disabled={sending}
            className="w-full py-3 rounded-full text-[12px] font-semibold tracking-[0.14em] border transition-colors hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
          >
            {sending ? 'SENDING...' : 'SEND ME A LINK'}
          </button>
        </form>
      ) : (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowEmail(true)}
            className="text-[12px] underline hover:text-white transition-colors"
            style={{ color: '#a0a0a0' }}
          >
            Or email me a sign-in link instead
          </button>
        </div>
      )}
    </div>
  );
}

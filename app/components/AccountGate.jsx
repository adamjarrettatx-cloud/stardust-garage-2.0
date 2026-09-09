'use client';

// AccountGate.jsx
//
// Two-tab (Create account | Sign in) authentication surface used ANYWHERE a
// Stardust account is required before an action can proceed. Today the only
// caller is the InternalTicketModal ticket-purchase flow, but this component
// was pulled out on its own so the same widget can be dropped into future
// gated actions (event RSVPs, waitlist joins, private-space rentals) without
// re-implementing the sign-up rules.
//
// Design intent:
//   * "Create account" is the default tab because most people hitting the
//     gate are first-timers who saw a BUY TICKETS pill and clicked it.
//   * Both tabs lead with a Google button; Google auth means we skip Twilio
//     for phone verification (the phone is captured post-callback via the
//     small "Complete your profile" nudge on the destination page).
//   * The password path posts to /api/free-account/create-no-verify \u2014
//     mirrors the trial-pass verify/check route EXCEPT the Twilio step is
//     skipped. On success the client immediately signs in with the same
//     password so we finish with a live Supabase session in one round-trip.
//   * "Already registered" flips the UI to the Sign In tab with the email
//     prefilled rather than blocking with a red error, so an existing member
//     who mistakenly picked Create doesn't have to retype anything.
//   * Styling deliberately matches app/login/page.js: dark #141414 inputs,
//     white pill CTA, min 16px font size on mobile to defeat Safari's
//     "zoom the page on tap" behaviour.
//
// The component is deliberately UNAWARE of what happens after success. It
// calls `onSuccess()` and lets the parent (modal, page, etc.) decide whether
// to advance a step, navigate, or refresh a server component.

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Field styles factored out because they repeat 4x below and any drift
// between the two tabs is a visual bug.
const inputStyle = {
  background: '#141414',
  borderColor: 'rgba(255,255,255,0.1)',
  color: '#f5f5f5',
  fontSize: 16, // >=16px prevents iOS Safari from zooming on focus
};
const inputClass = 'w-full px-5 py-3.5 rounded-full outline-none border transition-colors focus:border-white/30';
const labelClass = 'block text-[12px] font-semibold tracking-[0.14em] mb-2';
const labelStyle = { color: '#8a8a8a' };
const primaryButtonClass = 'w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50';
const primaryButtonStyle = { background: '#ffffff', color: '#0a0a0a' };

// Renders a Google logo + label. Kept inline to avoid pulling in an icon
// library for a single button.
function GoogleButton({ onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full py-3.5 rounded-full text-[13px] font-semibold tracking-[0.04em] transition-all hover:-translate-y-0.5 disabled:opacity-50 flex items-center justify-center gap-3"
      style={{ background: '#ffffff', color: '#0a0a0a' }}
    >
      {/* Inline Google G so we don't ship an image asset. */}
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#d9c48c" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#8a5109" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#8a5109" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      {label}
    </button>
  );
}

export default function AccountGate({
  onSuccess,
  defaultTab = 'signup',
  headline = 'Sign in to continue',
  subheadline = null,
  prefillEmail = '',
}) {
  const [tab, setTab] = useState(defaultTab === 'signin' ? 'signin' : 'signup');

  // Sign-up form state
  const [suName, setSuName] = useState('');
  const [suEmail, setSuEmail] = useState(prefillEmail);
  const [suPassword, setSuPassword] = useState('');
  const [suPhone, setSuPhone] = useState('');

  // Sign-in form state. Pre-fill from prop so the mobile app can pass the
  // signed-in user's email through as ?email=... on the /events/[slug]
  // deep-link \u2014 saves the buyer one keystroke and hints that they should
  // sign in with the account they already use in the app.
  const [siEmail, setSiEmail] = useState(prefillEmail);
  const [siPassword, setSiPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const supabase = createClient();

  // Build the redirect URL Google hands back to. Same-page + ?signup=complete
  // is the contract with InternalTicketModal: on mount, if signup=complete is
  // present AND the user is authenticated, the modal jumps straight to the
  // checkout step so the buyer doesn't lose their pre-click intent.
  function googleRedirectTo() {
    if (typeof window === 'undefined') return undefined;
    const nextPath = window.location.pathname + (window.location.search
      ? window.location.search.replace(/([?&])signup=complete&?/g, '$1').replace(/[?&]$/, '') + '&signup=complete'
      : '?signup=complete');
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
  }

  async function handleGoogle() {
    setError('');
    setBusy(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: googleRedirectTo() },
    });
    if (oauthError) {
      setError(oauthError.message || 'Google sign-in failed.');
      setBusy(false);
    }
    // On success the browser redirects away; no cleanup needed.
  }

  async function handleSignUp(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/free-account/create-no-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: suName,
          email: suEmail,
          password: suPassword,
          phone: suPhone,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 409 "already registered" \u2014 flip to Sign In tab with email prefilled
        // instead of a dead-end red message.
        if (res.status === 409 || data?.code === 'already_registered') {
          setSiEmail(suEmail);
          setTab('signin');
          setError('That email is already registered \u2014 sign in below.');
          return;
        }
        throw new Error(data?.error || 'Could not create account.');
      }

      // Immediately establish a browser session using the same credentials
      // the server just accepted. This is safe: the password only just left
      // this form, has already been rejected as too-short client-side, and
      // Supabase's sign-in will surface any post-create anomaly.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: suEmail,
        password: suPassword,
      });
      if (signInError) {
        throw new Error(signInError.message || 'Signed up, but sign-in failed.');
      }

      onSuccess?.();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: siEmail,
        password: siPassword,
      });
      if (signInError) {
        throw new Error(signInError.message || 'Sign-in failed.');
      }
      onSuccess?.();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ color: '#f5f5f5' }}>
      {headline && (
        <h2 className="text-[20px] font-extrabold -tracking-[0.01em] mb-1.5 leading-[1.15]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          {headline}
        </h2>
      )}
      {subheadline && (
        <p className="text-[13px] mb-5" style={{ color: '#a0a0a0' }}>{subheadline}</p>
      )}

      {/* Tab bar. Two equal segments; active tab gets the white pill treatment. */}
      <div
        className="flex mb-5 rounded-full p-1"
        style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {['signup', 'signin'].map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => { setTab(key); setError(''); }}
            className="flex-1 py-2 rounded-full text-[12px] font-semibold tracking-[0.12em] transition-colors"
            style={{
              background: tab === key ? '#ffffff' : 'transparent',
              color: tab === key ? '#0a0a0a' : '#a0a0a0',
            }}
          >
            {key === 'signup' ? 'CREATE ACCOUNT' : 'SIGN IN'}
          </button>
        ))}
      </div>

      {tab === 'signup' ? (
        <form onSubmit={handleSignUp} className="space-y-3.5">
          <GoogleButton onClick={handleGoogle} disabled={busy} label="Continue with Google" />
          <div className="flex items-center gap-3 my-2" aria-hidden="true">
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <div className="text-[11px] tracking-[0.14em]" style={{ color: '#666' }}>OR</div>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>FULL LEGAL NAME</label>
            <input
              type="text"
              value={suName}
              onChange={(e) => setSuName(e.target.value)}
              required
              autoComplete="name"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className={labelClass} style={labelStyle}>EMAIL</label>
            <input
              type="email"
              value={suEmail}
              onChange={(e) => setSuEmail(e.target.value)}
              required
              autoComplete="email"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className={labelClass} style={labelStyle}>PASSWORD (MIN 8)</label>
            <input
              type="password"
              value={suPassword}
              onChange={(e) => setSuPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className={labelClass} style={labelStyle}>MOBILE PHONE</label>
            <input
              type="tel"
              value={suPhone}
              onChange={(e) => setSuPhone(e.target.value)}
              required
              autoComplete="tel"
              placeholder="+1 555 555 5555"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          {error && <div className="text-[13px] text-red-400">{error}</div>}

          <button
            type="submit"
            disabled={busy}
            className={primaryButtonClass}
            style={primaryButtonStyle}
          >
            {busy ? 'CREATING ACCOUNT\u2026' : 'CREATE ACCOUNT & CONTINUE'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleSignIn} className="space-y-3.5">
          <GoogleButton onClick={handleGoogle} disabled={busy} label="Sign in with Google" />
          <div className="flex items-center gap-3 my-2" aria-hidden="true">
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <div className="text-[11px] tracking-[0.14em]" style={{ color: '#666' }}>OR</div>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.1)' }} />
          </div>

          <div>
            <label className={labelClass} style={labelStyle}>EMAIL</label>
            <input
              type="email"
              value={siEmail}
              onChange={(e) => setSiEmail(e.target.value)}
              required
              autoComplete="email"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label className={labelClass} style={labelStyle}>PASSWORD</label>
            <input
              type="password"
              value={siPassword}
              onChange={(e) => setSiPassword(e.target.value)}
              required
              autoComplete="current-password"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          {error && <div className="text-[13px] text-red-400">{error}</div>}

          <button
            type="submit"
            disabled={busy}
            className={primaryButtonClass}
            style={primaryButtonStyle}
          >
            {busy ? 'SIGNING IN\u2026' : 'SIGN IN & CONTINUE'}
          </button>
        </form>
      )}
    </div>
  );
}

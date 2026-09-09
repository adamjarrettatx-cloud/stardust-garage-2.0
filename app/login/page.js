'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Wordmark from '@/app/components/Wordmark';

export default function UnifiedLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Google OAuth handler. Ticket-buyer accounts are created with Google in
  // the InternalTicketModal, so "just log back in" from /login used to be
  // impossible — they have no password. Same redirect contract as
  // AccountGate: /auth/callback?next=<encoded next>, where /auth/callback is
  // the server Route Handler that exchanges the code and sets cookies.
  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    const supabase = createClient();
    const url = new URL(window.location.href);
    const nextParam = url.searchParams.get('next') || '/account/tickets';
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextParam)}`;
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });
    if (oauthError) {
      setError(oauthError.message || 'Google sign-in failed.');
      setLoading(false);
    }
    // On success the browser navigates away; no further cleanup.
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Role is sourced from team_members.role (server-verified table), not
    // client-trusted user_metadata. The legacy is_admin metadata flag is kept
    // as a fallback only, matching middleware.js's existing behavior.
    const { data: tm } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', data.user.id)
      .maybeSingle();

    const role = tm?.role || (data?.user?.user_metadata?.is_admin ? 'admin' : null);
    // Read the redirect-back param directly (avoids useSearchParams, which
    // would force a Suspense boundary around this client page).
    const next = new URLSearchParams(window.location.search).get('next');

    let destination;
    if (role === 'admin') destination = next || '/bananas';
    else if (role === 'team') destination = next || '/team/calendar';
    else destination = next || '/member';

    router.push(destination);
    router.refresh();
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[400px]">
        <div className="flex justify-center mb-10">
          <Wordmark size="md" align="center" />
        </div>
        <h1 className="text-[28px] font-extrabold -tracking-[0.02em] mb-2 text-center leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Sign In
        </h1>
        <p className="text-[13px] text-center mb-10" style={{ color: '#8a8a8a' }}>
          Members sign in here
        </p>

        {/* Google sign-in. Kept above the password form because ticket buyers
            — who authenticated with Google during checkout and have no
            password — land here after middleware bounces them and this is
            their only path back in. */}
        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="w-full py-3.5 rounded-full text-[13px] font-semibold tracking-[0.06em] flex items-center justify-center gap-3 border transition-colors hover:bg-white/[0.04] disabled:opacity-50"
          style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}
        >
          {/* Inline Google G. Matches AccountGate's inline SVG so we don't
              ship a separate image asset. */}
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#d9c48c" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#8a5109" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#8a5109" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            <path fill="none" d="M0 0h48v48H0z" />
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3 my-6">
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
          <span className="text-[11px] font-semibold tracking-[0.14em]" style={{ color: '#8a8a8a' }}>OR</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-[12px] font-semibold tracking-[0.14em] mb-2" style={{ color: '#8a8a8a' }}>EMAIL</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f5f5' }} />
          </div>

          <div>
            <label className="block text-[12px] font-semibold tracking-[0.14em] mb-2" style={{ color: '#8a8a8a' }}>PASSWORD</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f5f5' }} />
          </div>

          {error && (
            <div className="text-[13px] text-red-400 text-center">{error}</div>
          )}

          <button type="submit" disabled={loading} className="w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50" style={{ background: '#ffffff', color: '#0a0a0a' }}>
            {loading ? 'SIGNING IN...' : 'SIGN IN'}
          </button>
        </form>

        <div className="text-center mt-6">
          <Link href="/forgot-password" className="text-[12px] underline hover:text-white transition-colors" style={{ color: '#a0a0a0' }}>
            Forgot password?
          </Link>
        </div>

        <p className="text-[12px] text-center mt-8" style={{ color: '#8a8a8a' }}>
          Not a member yet?{' '}
          <Link href="/members" className="underline hover:text-white transition-colors" style={{ color: '#a0a0a0' }}>
            Apply for membership
          </Link>
        </p>
      </div>
    </main>
  );
}

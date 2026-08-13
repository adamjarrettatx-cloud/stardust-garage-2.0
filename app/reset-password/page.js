'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import Wordmark from '@/app/components/Wordmark';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [validSession, setValidSession] = useState(null); // null = checking, true/false after check

  // The reset email links here with ?token_hash=...&type=recovery (see
  // buildPasswordResetUrl + /api/auth/request-password-reset) instead of
  // Supabase's own redirect, which is why we redeem it ourselves via
  // verifyOtp rather than just reading an already-established session —
  // mirrors ActivateClient's handling of the partner invite link exactly.
  // Any already-in-flight link sent before this change lands still arrives
  // as a plain Supabase-established session with no token_hash in the URL,
  // so that path is kept as a fallback.
  useEffect(() => {
    const checkSession = async () => {
      const supabase = createClient();

      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get('token_hash');
      if (tokenHash) {
        await supabase.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
        // Single-use token: keep it out of the address bar so a refresh or a
        // shared URL doesn't look like an expired link.
        window.history.replaceState(null, '', window.location.pathname);
      }

      const { data: { session } } = await supabase.auth.getSession();
      setValidSession(Boolean(session));
    };
    checkSession();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords don\'t match.');
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    // Auto-redirect to /member after a beat
    setTimeout(() => {
      router.push('/member');
      router.refresh();
    }, 2000);
  };

  // Still checking session
  if (validSession === null) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-12">
        <p className="text-[14px]" style={{ color: '#8a8a8a' }}>Loading...</p>
      </main>
    );
  }

  // No valid session - link expired or invalid
  if (!validSession) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px] text-center">
          <div className="flex justify-center mb-10">
            <Wordmark size="md" align="center" />
          </div>
          <h1 className="text-[24px] font-extrabold -tracking-[0.02em] mb-4 leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Link expired or invalid.
          </h1>
          <p className="text-[14px] leading-[1.6] mb-8" style={{ color: '#a0a0a0' }}>
            Reset links expire after 1 hour. Request a new one to continue.
          </p>
          <Link href="/forgot-password" className="inline-block px-6 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5" style={{ background: '#ffffff', color: '#0a0a0a' }}>
            REQUEST NEW LINK
          </Link>
        </div>
      </main>
    );
  }

  // Password changed successfully
  if (success) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px] text-center">
          <div className="flex justify-center mb-10">
            <Wordmark size="md" align="center" />
          </div>
          <div className="text-[11px] font-semibold tracking-[0.28em] mb-4" style={{ color: '#a0a0a0' }}>PASSWORD UPDATED</div>
          <h1 className="text-[28px] font-extrabold -tracking-[0.02em] mb-4 leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            You&apos;re all set.
          </h1>
          <p className="text-[14px] leading-[1.6]" style={{ color: '#a0a0a0' }}>
            Redirecting to your member area...
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-[400px]">
        <div className="flex justify-center mb-10">
          <Wordmark size="md" align="center" />
        </div>
        <h1 className="text-[28px] font-extrabold -tracking-[0.02em] mb-2 text-center leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Set New Password
        </h1>
        <p className="text-[13px] text-center mb-10" style={{ color: '#8a8a8a' }}>
          Choose a password you&apos;ll remember.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[12px] font-semibold tracking-[0.14em] mb-2" style={{ color: '#8a8a8a' }}>NEW PASSWORD</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f5f5' }} />
          </div>

          <div>
            <label className="block text-[12px] font-semibold tracking-[0.14em] mb-2" style={{ color: '#8a8a8a' }}>CONFIRM PASSWORD</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f5f5' }} />
          </div>

          <p className="text-[11px] leading-[1.5]" style={{ color: 'rgba(255,255,255,0.4)' }}>
            Minimum 8 characters.
          </p>

          {error && (
            <div className="text-[13px] text-red-400 text-center">{error}</div>
          )}

          <button type="submit" disabled={loading} className="w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50" style={{ background: '#ffffff', color: '#0a0a0a' }}>
            {loading ? 'UPDATING...' : 'UPDATE PASSWORD'}
          </button>
        </form>
      </div>
    </main>
  );
}

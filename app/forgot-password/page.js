'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import Wordmark from '@/app/components/Wordmark';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    setLoading(false);

    // We don't reveal whether the email exists - always show success.
    // This is standard security practice: prevents enumeration attacks.
    if (resetError) {
      // Log internally but still show success to user
      console.error('Reset password error:', resetError.message);
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px] text-center">
          <div className="flex justify-center mb-10">
            <Wordmark size="md" align="center" />
          </div>
          <div className="text-[11px] font-semibold tracking-[0.28em] mb-4" style={{ color: '#a0a0a0' }}>
            CHECK YOUR INBOX
          </div>
          <h1 className="text-[28px] font-extrabold -tracking-[0.02em] mb-4 leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Email sent.
          </h1>
          <p className="text-[14px] leading-[1.6] mb-8" style={{ color: '#a0a0a0' }}>
            If <span style={{ color: '#f5f5f5' }}>{email}</span> is registered with us, you&apos;ll receive a password reset link shortly. The link expires in 1 hour.
          </p>
          <Link href="/login" className="inline-block px-6 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5" style={{ background: '#ffffff', color: '#0a0a0a' }}>
            BACK TO LOGIN
          </Link>
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
          Reset Password
        </h1>
        <p className="text-[13px] text-center mb-10" style={{ color: '#8a8a8a' }}>
          Enter your email and we&apos;ll send you a reset link.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[12px] font-semibold tracking-[0.14em] mb-2" style={{ color: '#8a8a8a' }}>EMAIL</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.1)', color: '#f5f5f5' }} />
          </div>

          {error && (
            <div className="text-[13px] text-red-400 text-center">{error}</div>
          )}

          <button type="submit" disabled={loading} className="w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50" style={{ background: '#ffffff', color: '#0a0a0a' }}>
            {loading ? 'SENDING...' : 'SEND RESET LINK'}
          </button>
        </form>

        <p className="text-[12px] text-center mt-8" style={{ color: '#8a8a8a' }}>
          Remember it?{' '}
          <Link href="/login" className="underline hover:text-white transition-colors" style={{ color: '#a0a0a0' }}>
            Back to login
          </Link>
        </p>
      </div>
    </main>
  );
}

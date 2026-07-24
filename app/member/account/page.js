'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function AccountSettingsPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('New passwords don\'t match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from current.');
      return;
    }

    setLoading(true);
    const supabase = createClient();

    // First verify the current password by re-signing-in with it.
    // This is the standard approach for "change password" flows.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) {
      setError('Not signed in. Please refresh and try again.');
      setLoading(false);
      return;
    }

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (verifyError) {
      setError('Current password is incorrect.');
      setLoading(false);
      return;
    }

    // Current password verified - now update to the new one
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    setCurrentPassword('');
    setNewPassword('');
    setConfirm('');
    router.refresh();
  };

  return (
    <main className="max-w-[700px] mx-auto px-6 py-16">
      <Link href="/member" className="text-[12px] tracking-[0.14em] mb-4 inline-block hover:text-white transition-colors" style={{ color: 'var(--text-3)' }}>
        ← BACK TO MEMBER HOME
      </Link>
      <div className="text-[11px] font-semibold tracking-[0.28em] mb-3" style={{ color: 'var(--fg-a5)' }}>
        ACCOUNT SETTINGS
      </div>
      <h1 className="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-10" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
        Change Password
      </h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-[11px] font-semibold tracking-[0.14em] mb-2" style={{ color: 'var(--text-3)' }}>CURRENT PASSWORD</label>
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30" style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a1)', color: 'var(--text-1)' }} />
        </div>

        <div>
          <label className="block text-[11px] font-semibold tracking-[0.14em] mb-2" style={{ color: 'var(--text-3)' }}>NEW PASSWORD</label>
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30" style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a1)', color: 'var(--text-1)' }} />
        </div>

        <div>
          <label className="block text-[11px] font-semibold tracking-[0.14em] mb-2" style={{ color: 'var(--text-3)' }}>CONFIRM NEW PASSWORD</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30" style={{ background: 'var(--surface-1)', borderColor: 'var(--fg-a1)', color: 'var(--text-1)' }} />
        </div>

        <p className="text-[11px] leading-[1.5]" style={{ color: 'var(--fg-a4)' }}>
          Minimum 8 characters.
        </p>

        {error && <div className="text-[13px] text-red-400">{error}</div>}
        {success && <div className="text-[13px]" style={{ color: 'var(--st-80c878)' }}>Password updated successfully.</div>}

        <button type="submit" disabled={loading} className="w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50" style={{ background: '#ffffff', color: '#0a0a0a' }}>
          {loading ? 'UPDATING...' : 'UPDATE PASSWORD'}
        </button>
      </form>
    </main>
  );
}

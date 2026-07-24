'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Wordmark from '@/app/components/Wordmark';

export default function TeamLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Verify this user is actually a team member
    const { data: tm } = await supabase
      .from('team_members')
      .select('role')
      .eq('user_id', data.user.id)
      .single();

    if (!tm) {
      await supabase.auth.signOut();
      setError('Your account does not have team access.');
      setLoading(false);
      return;
    }

    router.push('/team/calendar');
    router.refresh();
  };

  const inputStyle = {
    background: '#141414',
    borderColor: 'rgba(255,255,255,0.1)',
    color: '#f5f5f5',
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-[400px]">
        <div className="flex justify-center mb-10">
          <Wordmark size="md" align="center" />
        </div>
        <h1
          className="text-[28px] font-extrabold -tracking-[0.02em] mb-2 text-center leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Team Login
        </h1>
        <p className="text-[13px] text-center mb-10" style={{ color: '#8a8a8a' }}>
          Stardust Garage team portal
        </p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-[12px] font-semibold tracking-[0.14em] mb-2" style={{ color: '#8a8a8a' }}>
              EMAIL
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30"
              style={inputStyle}
            />
          </div>

          <div>
            <label className="block text-[12px] font-semibold tracking-[0.14em] mb-2" style={{ color: '#8a8a8a' }}>
              PASSWORD
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-5 py-3.5 rounded-full text-[14px] outline-none border transition-colors focus:border-white/30"
              style={inputStyle}
            />
          </div>

          {error && (
            <div className="text-[13px] text-red-400 text-center">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-full text-[12px] font-semibold tracking-[0.16em] transition-all hover:-translate-y-0.5 disabled:opacity-50"
            style={{ background: '#ffffff', color: '#0a0a0a' }}
          >
            {loading ? 'SIGNING IN...' : 'SIGN IN'}
          </button>
        </form>
      </div>
    </main>
  );
}

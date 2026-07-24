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
          Members, team and admin all sign in here
        </p>

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

'use client';
import { useState } from 'react';
import Wordmark from '@/app/components/Wordmark';

export default function StationLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const res = await fetch('/api/station/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sign-in failed.');
      setPassword('');
      window.location.replace(data.destination);
    } catch (err) { setError(err.message); setBusy(false); }
  }
  const input = 'w-full rounded-xl border border-white/20 bg-[#141414] px-4 py-3 text-base text-white outline-none focus:border-white';
  return <main className="min-h-screen bg-[#0a0a0a] text-[#f5f5f5] flex items-center justify-center px-6 py-12">
    <div className="w-full max-w-[400px]">
      <div className="flex justify-center mb-8"><Wordmark size="md" align="center" /></div>
      <h1 className="text-2xl font-bold text-center mb-3">Station sign in</h1>
      <p className="text-sm text-[#aaa] text-center mb-8">Sign in to your assigned workspace.</p>
      <form onSubmit={submit} className="space-y-5">
        <div><label htmlFor="station-username" className="block text-sm font-semibold mb-2">Username</label>
          <input id="station-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32}
            value={username} onChange={e => setUsername(e.target.value)} required className={input} disabled={busy} /></div>
        <div><label htmlFor="station-password" className="block text-sm font-semibold mb-2">Password</label>
          <input id="station-password" name="password" type="password" autoComplete="current-password" maxLength={128}
            value={password} onChange={e => setPassword(e.target.value)} required className={input} disabled={busy} /></div>
        {error && <p className="text-sm text-red-300" role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-full bg-white text-black py-3.5 font-semibold disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="mt-6 text-sm text-[#aaa]">Your role is assigned by the owner. Actions are recorded under the station name, not an individual staff member.</p>
      <p className="mt-4 text-sm text-[#aaa]">Need access or a password reset? Ask the owner.</p>
      <button disabled={busy} className="inline-block mt-6 text-sm underline" onClick={async () => {
        setBusy(true); setError('');
        try {
          const res = await fetch('/api/station/logout', { method: 'POST' });
          if (!res.ok) throw new Error('Could not close the station session. Retry.');
          window.location.replace('/login');
        } catch (err) { setError(err.message); setBusy(false); }
      }}>Personal account sign in</button>
    </div>
  </main>;
}

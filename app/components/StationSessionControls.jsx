'use client';
import { useEffect, useState } from 'react';

export default function StationSessionControls() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    const check = async () => {
      try {
        const res = await fetch('/api/station/session', { cache: 'no-store' });
        if (!disposed && res.status === 401) window.location.replace('/staff/login?expired=1');
      } catch { /* APIs independently fail closed; retry connectivity. */ }
    };
    void check();
    const interval = setInterval(check, 30_000);
    const focus = () => void check();
    window.addEventListener('focus', focus);
    return () => { disposed = true; clearInterval(interval); window.removeEventListener('focus', focus); };
  }, []);
  async function logout() {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/station/logout', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not sign out.');
      window.location.replace('/staff/login');
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return <div>
    <button onClick={logout} disabled={busy} className="rounded-lg border border-current px-3 py-2 text-sm font-semibold">
      {busy ? 'Signing out…' : 'Sign out station'}
    </button>
    {error && <p role="alert" className="text-sm">{error}</p>}
  </div>;
}

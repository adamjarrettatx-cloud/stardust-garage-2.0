'use client';

import { useEffect, useState } from 'react';
import CompleteProfileNudge from '@/app/account/tickets/CompleteProfileNudge';

// OAuth providers create an authentication identity before we control the
// profile form. Do not treat a provider display name as a completed SDG profile.
export default function AccountLegalNameGate({ children }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(''); setProfile(null);
    fetch('/api/account/legal-name', { cache: 'no-store' }).then(async res => {
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Could not check your profile.');
      if (!cancelled) setProfile(body);
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [attempt]);
  if (error) return <div role="alert" className="text-sm">
    <p>{error}</p>
    <button type="button" className="underline py-3" onClick={() => setAttempt(v => v + 1)}>Retry profile check</button>
  </div>;
  if (!profile) return <p className="text-sm py-4">Checking your profile…</p>;
  if (!profile.complete) return <CompleteProfileNudge initialName={profile.fullName} initialPhone={profile.phone}
    onSaved={() => setAttempt(v => v + 1)} />;
  return children;
}

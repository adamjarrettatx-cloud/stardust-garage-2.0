'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function WithdrawButton({ id, disabled = false }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const withdraw = async () => {
    if (!window.confirm('Withdraw this pitch?')) return;
    setBusy(true); setError('');
    const res = await fetch(`/api/portal/pitches/${id}/withdraw`, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(json.error || 'Could not withdraw.'); return; }
    router.refresh();
  };
  return (
    <>
      {error && <span className="pg-error" role="alert" style={{ margin: 0 }}>{error}</span>}
      <button type="button" className="pg-btn" style={{ minHeight: 32, padding: '4px 10px', fontSize: 12 }} onClick={withdraw} disabled={busy || disabled} title={disabled ? 'View-only in View Portal' : undefined}>
        {busy ? 'Withdrawing…' : 'Withdraw'}
      </button>
    </>
  );
}

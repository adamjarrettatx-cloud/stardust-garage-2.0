'use client';

import { useState } from 'react';
import { adminFetch } from '@/lib/admin-fetch';

export default function MercuryConnectionStatus() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  async function check() {
    setBusy(true);
    setResult(null);
    setError('');
    try { setResult(await adminFetch('/api/admin/pay-requests/mercury-connection')); }
    catch (err) { setError(err.message || 'Could not verify the Mercury connection.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="mb-5 rounded-[10px] border p-4" style={{ borderColor: 'var(--auth-card-border)', background: 'var(--auth-card-bg-alt)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-bold" style={{ color: 'var(--auth-text-strong)' }}>MERCURY CONNECTION</h2>
          <p className="text-[13px] mt-1" style={{ color: 'var(--auth-muted)' }}>Read-only account check. Does not queue or send a payment.</p>
        </div>
        <button type="button" onClick={check} disabled={busy}
          className="rounded-full border px-4 py-2.5 text-[12px] font-semibold disabled:opacity-40"
          style={{ borderColor: 'var(--auth-card-border-strong)', color: 'var(--auth-text)' }}>
          {busy ? 'CHECKING...' : 'CHECK MERCURY CONNECTION'}
        </button>
      </div>
      {error && <p role="alert" className="text-[13px] mt-3" style={{ color: 'var(--auth-danger)' }}>{error}</p>}
      {result && (
        <div role="status" className="text-[13px] mt-3" style={{ color: 'var(--auth-text)' }}>
          {!result.configured ? (
            <p>Mercury is not configured for this deployment. Add the server-side token, environment, and source-account ID. Keep queueing disabled until testing is complete.</p>
          ) : result.verified ? (
            <>
              <p>Connected to {result.account?.nickname || result.account?.name || 'the configured account'} ({result.environment}).</p>
              <p className="mt-1 break-all">Account ID: {result.account?.id}</p>
              <p className="mt-1">Account status: {result.account?.status || 'unknown'}.{result.account?.status !== 'active' && ' Keep payouts disabled until Mercury confirms this account is active.'}</p>
              <p className="mt-1">{result.queue_enabled ? 'Queueing is enabled.' : 'Queueing is disabled.'} This check does not verify payment permissions, self-approval, or settlement.</p>
            </>
          ) : <p>Connection not verified. Keep queueing disabled.</p>}
        </div>
      )}
    </div>
  );
}

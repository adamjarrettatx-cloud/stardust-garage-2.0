'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';

// Mirrors the cached TicketTailor metrics into the cash-flow ledger. This does
// not call TicketTailor — refreshing the cache itself is the separate "Refresh
// metrics" action on Event Analytics / the Financial Calendar.
export default function SyncTicketTailorButton({ t }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function onClick() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/financial-ledger/sync-tickettailor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const parts = [`${res.synced} synced`];
      const skippedTotal = Object.values(res.skipped || {}).reduce((sum, n) => sum + n, 0);
      if (skippedTotal) parts.push(`${skippedTotal} skipped`);
      setMsg(parts.join(' · '));
      router.refresh();
    } catch (err) {
      setMsg(err?.message || 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        data-testid="cf-sync-tt"
        className="text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2 transition-colors disabled:opacity-50"
        style={{ background: t.btnBg, color: t.btnText }}
      >
        {busy ? 'Syncing…' : 'Sync TicketTailor'}
      </button>
      {msg && <span className="text-[12px]" style={{ color: t.muted }}>{msg}</span>}
    </div>
  );
}

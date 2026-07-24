'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';

// Triggers a manual, read-only TicketTailor metrics refresh. Calls the admin
// POST route (which never writes to TicketTailor) and refreshes the page so the
// newly cached numbers render. With an `eventId` it scopes the refresh to a
// single event; without one it refreshes the whole portfolio.
export default function RefreshMetricsButton({ eventId = null, label = 'Refresh metrics', compact = false }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function onClick() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await adminFetch('/api/admin/refresh-event-metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(eventId ? { eventId } : {}),
      });
      const parts = [`${res.refreshed} refreshed`];
      if (res.skipped) parts.push(`${res.skipped} not configured`);
      if (res.failed) parts.push(`${res.failed} failed`);
      setMsg(parts.join(' · '));
      router.refresh();
    } catch (err) {
      setMsg(err?.message || 'Refresh failed');
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
        className={
          compact
            ? 'text-[11px] font-semibold tracking-[0.10em] uppercase rounded-[8px] px-3 py-1.5 transition-colors disabled:opacity-50'
            : 'text-[12px] font-semibold tracking-[0.10em] uppercase rounded-[10px] px-4 py-2 transition-colors disabled:opacity-50'
        }
        style={{ background: 'var(--st-ffb84d)', color: 'var(--surface-1)' }}
      >
        {busy ? 'Refreshing…' : label}
      </button>
      {msg && (
        <span className="text-[12px]" style={{ color: 'var(--text-3)' }}>{msg}</span>
      )}
    </div>
  );
}

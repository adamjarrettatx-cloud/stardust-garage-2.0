'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';

// Compact, icon-only per-event metrics refresh for the analytics table. Read-
// only against TicketTailor (scoped to one event). Status is conveyed through
// the button glyph/title rather than an inline message so it fits a table cell.
export default function RowRefreshButton({ eventId }) {
  const router = useRouter();
  const [state, setState] = useState('idle'); // idle | busy | done | error

  async function onClick() {
    setState('busy');
    try {
      await adminFetch('/api/admin/refresh-event-metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      setState('done');
      router.refresh();
      setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 4000);
    }
  }

  const glyph = state === 'busy' ? '…' : state === 'done' ? '✓' : state === 'error' ? '!' : '↻';
  const color = state === 'error' ? 'var(--st-f87171)' : state === 'done' ? 'var(--st-4ade80)' : 'var(--st-ffb84d)';
  const title =
    state === 'error' ? 'Refresh failed — try again' : 'Refresh this event’s metrics (read-only)';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === 'busy'}
      title={title}
      aria-label="Refresh metrics for this event"
      className="text-[13px] leading-none px-1.5 py-1 rounded-[6px] disabled:opacity-50"
      style={{ border: '1px solid var(--fg-a12)', color }}
    >
      {glyph}
    </button>
  );
}

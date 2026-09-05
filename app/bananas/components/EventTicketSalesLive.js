'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminFetch } from '@/lib/admin-fetch';

// Live ticket sales + gross for one event, rendered inline on the Events list.
//
// Why this lives on the row: the owner wants to see how a ticketed event is
// doing without leaving the dashboard for TicketTailor or the analytics page.
// The initial number is server-rendered from the cached
// public.event_ticket_metrics row (see app/bananas/page.js), so the list is
// never blank waiting on a fetch. The refresh button posts to the existing
// scoped route (/api/admin/refresh-event-metrics with { eventId }), which
// re-pulls TicketTailor for that one event and re-upserts the cache. We then
// call router.refresh() so the server component re-reads the cache and the
// new number replaces the old one in place.
//
// Non-ticketed events (no tt_event_series_id) render nothing at all, so an
// internal-only micro party never shows a misleading "0 sold" beside it.

function formatCents(cents) {
  if (cents == null) return '$0';
  const dollars = cents / 100;
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatFetchedAt(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const now = Date.now();
  const seconds = Math.max(0, Math.round((now - t) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function EventTicketSalesLive({ eventId, hasTicketTailor, initialMetrics }) {
  const router = useRouter();
  const [state, setState] = useState('idle'); // idle | busy | done | error
  const [errorMsg, setErrorMsg] = useState(null);

  // Nothing to show for an event that never had ticketed sales in the first
  // place. Rendering "0 tickets · $0" beside an internal micro party would be
  // technically true and completely uninformative.
  if (!hasTicketTailor) return null;

  const metrics = initialMetrics || null;
  const sold = Number(metrics?.tickets_sold || 0);
  const grossCents = Number(metrics?.gross_cents || 0);
  const status = metrics?.status || 'pending';
  const fetchedLabel = formatFetchedAt(metrics?.fetched_at);

  async function onRefresh() {
    setState('busy');
    setErrorMsg(null);
    try {
      await adminFetch('/api/admin/refresh-event-metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      setState('done');
      router.refresh();
      setTimeout(() => setState('idle'), 2500);
    } catch (err) {
      setErrorMsg(String(err?.message || err));
      setState('error');
      setTimeout(() => setState('idle'), 4000);
    }
  }

  // Layout mirrors the pill row on the right of the event: a small,
  // right-aligned block that never squeezes the title. Two lines by default so
  // the two numbers do not compete on one crowded row: sales up top, gross
  // underneath, refresh glyph inline to the right of the numbers.
  return (
    <div className="flex flex-col items-end gap-0.5 flex-shrink-0 min-w-[128px]">
      <div className="flex items-center gap-2">
        {status === 'error' ? (
          <span
            className="text-[11px] font-semibold tracking-[0.06em]"
            style={{ color: 'var(--auth-warn, #f87171)' }}
            title={metrics?.error_detail || 'Ticket Tailor refresh failed'}
          >
            LIVE UNAVAILABLE
          </span>
        ) : status === 'not_configured' ? (
          <span
            className="text-[11px] font-semibold tracking-[0.06em]"
            style={{ color: 'var(--auth-faint)' }}
            title={metrics?.error_detail || 'Ticket Tailor is not configured'}
          >
            TICKETING NOT CONFIGURED
          </span>
        ) : (
          <>
            <span
              className="text-[15px] font-bold leading-none tabular-nums"
              style={{ color: 'var(--auth-text)' }}
              title={`Live tickets sold for this event${
                fetchedLabel ? ` \u2014 refreshed ${fetchedLabel}` : ''
              }`}
            >
              {sold.toLocaleString('en-US')}
            </span>
            <span
              className="text-[11px] font-semibold tracking-[0.06em]"
              style={{ color: 'var(--auth-muted)' }}
            >
              SOLD
            </span>
          </>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={state === 'busy'}
          title={
            state === 'error'
              ? `Refresh failed \u2014 ${errorMsg || 'try again'}`
              : `Refresh live sales${fetchedLabel ? ` (last: ${fetchedLabel})` : ''}`
          }
          aria-label="Refresh live ticket sales for this event"
          className="text-[12px] leading-none px-1.5 py-1 rounded-[6px] disabled:opacity-50"
          style={{
            border: '1px solid var(--auth-card-border)',
            color:
              state === 'error'
                ? 'var(--auth-warn, #f87171)'
                : state === 'done'
                  ? 'var(--auth-success, #4ade80)'
                  : 'var(--auth-muted)',
          }}
        >
          {state === 'busy' ? '\u2026' : state === 'done' ? '\u2713' : state === 'error' ? '!' : '\u21bb'}
        </button>
      </div>
      {status === 'ok' || status === 'pending' ? (
        <div
          className="text-[12px] font-semibold tabular-nums"
          style={{ color: 'var(--auth-muted)' }}
          title="Gross ticket revenue before processor and platform fees"
        >
          {formatCents(grossCents)} gross
        </div>
      ) : null}
    </div>
  );
}

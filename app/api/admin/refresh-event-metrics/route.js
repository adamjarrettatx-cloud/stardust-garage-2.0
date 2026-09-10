import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { listOrders, listIssuedTickets } from '@/lib/tickettailor';
import {
  buildMetricsSnapshot,
  buildInternalMetricsSnapshot,
  buildPlaceholderMetricsRow,
} from '@/lib/event-analytics';
import { classifyCronAuth } from '@/lib/event-metrics-auth';

export const runtime = 'nodejs';

// Core refresh routine. Two providers feed the same public.event_ticket_metrics
// cache:
//   * TicketTailor — READ-ONLY external API pull via lib/tickettailor.js
//   * Internal ticketing — local aggregation over public.orders / public.tickets
// The Events list on /bananas reads that cache, so both providers surface the
// live sold/gross widget in the same spot. Events with neither provider are
// recorded as `not_configured` so a real zero is never confused with a guess.
// The only writes are upserts into public.event_ticket_metrics.

// Aggregate an internal-ticketing event's live sales directly from our own
// public.orders / public.tickets tables. Uses the admin (service-role) client
// that the refresh route already runs with, so RLS on those tables does not
// block the read. Returns the same cache-row shape as the TicketTailor path
// so both providers upsert together in one batch.
async function buildInternalRow(supabase, event, fetchedAt) {
  const [ordersRes, ticketsRes] = await Promise.all([
    supabase
      .from('orders')
      .select('status, total_cents, fees_cents, refunded_cents')
      .eq('event_id', event.id),
    supabase.from('tickets').select('status').eq('event_id', event.id),
  ]);
  if (ordersRes.error) throw new Error('orders read failed: ' + ordersRes.error.message);
  if (ticketsRes.error) throw new Error('tickets read failed: ' + ticketsRes.error.message);
  return buildInternalMetricsSnapshot({
    eventId: event.id,
    orders: ordersRes.data || [],
    tickets: ticketsRes.data || [],
    fetchedAt,
  });
}

async function refreshMetrics(supabase, { eventId = null } = {}) {
  // ticketing_mode drives the source choice below: 'internal' events roll up
  // from our own orders/tickets, everything else falls through to the existing
  // TicketTailor pull (or a placeholder when the event is not TT-linked).
  let query = supabase.from('events').select('id, title, tt_event_series_id, ticketing_mode');
  // Optional single-event scope. Used by the per-event "Refresh metrics" button
  // so an admin can update one row without re-pulling the whole portfolio.
  query = eventId
    ? query.eq('id', eventId)
    : query.order('event_date', { ascending: false }).limit(300);
  const { data: events, error } = await query;
  if (error) throw new Error('Failed to load events: ' + error.message);

  const ttConfigured = Boolean(process.env.TICKETTAILOR_API_KEY);
  const fetchedAt = new Date().toISOString();
  const rows = [];
  let refreshed = 0;
  let skipped = 0;
  let failed = 0;

  for (const event of events || []) {
    // Internal (first-party) ticketing — aggregate live sales from our own
    // public.orders / public.tickets. No external API call, so this always
    // works even without a TicketTailor key, and there is no rate limit to
    // worry about on the per-row refresh button.
    if (event.ticketing_mode === 'internal') {
      try {
        rows.push(await buildInternalRow(supabase, event, fetchedAt));
        refreshed++;
      } catch (err) {
        rows.push(
          buildPlaceholderMetricsRow({
            eventId: event.id,
            ttEventSeriesId: null,
            status: 'error',
            source: 'internal',
            errorDetail: String(err?.message || err).slice(0, 500),
            fetchedAt,
          }),
        );
        failed++;
      }
      continue;
    }

    // No TT series → we cannot pull real numbers. Record a clear, honest
    // placeholder rather than guessing.
    if (!event.tt_event_series_id) {
      rows.push(
        buildPlaceholderMetricsRow({
          eventId: event.id,
          ttEventSeriesId: null,
          errorDetail: 'Event is not linked to a TicketTailor event series.',
          fetchedAt,
        }),
      );
      skipped++;
      continue;
    }

    // API key missing → cannot make read calls; record not_configured so the
    // dashboard explains *why* there are no numbers instead of showing zeros.
    if (!ttConfigured) {
      rows.push(
        buildPlaceholderMetricsRow({
          eventId: event.id,
          ttEventSeriesId: event.tt_event_series_id,
          errorDetail: 'TICKETTAILOR_API_KEY is not configured in this environment.',
          fetchedAt,
        }),
      );
      skipped++;
      continue;
    }

    try {
      const [orders, issuedTickets] = await Promise.all([
        listOrders({ eventSeriesId: event.tt_event_series_id }),
        listIssuedTickets({ eventSeriesId: event.tt_event_series_id }),
      ]);
      rows.push(
        buildMetricsSnapshot({
          eventId: event.id,
          ttEventSeriesId: event.tt_event_series_id,
          orders,
          issuedTickets,
          fetchedAt,
        }),
      );
      refreshed++;
    } catch (err) {
      rows.push(
        buildPlaceholderMetricsRow({
          eventId: event.id,
          ttEventSeriesId: event.tt_event_series_id,
          status: 'error',
          source: 'tickettailor',
          errorDetail: String(err?.message || err).slice(0, 500),
          fetchedAt,
        }),
      );
      failed++;
    }
  }

  if (rows.length) {
    const { error: upsertError } = await supabase
      .from('event_ticket_metrics')
      .upsert(rows, { onConflict: 'event_id' });
    if (upsertError) throw new Error('Failed to cache metrics: ' + upsertError.message);
  }

  return { refreshed, skipped, failed, total: rows.length, ttConfigured, fetchedAt };
}

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/admin/refresh-event-metrics
// Manual refresh by a signed-in admin. Read-only against TicketTailor.
// Optional body { eventId } scopes the refresh to a single event.
export async function POST(request) {
  try {
    const { unauthorized, reason } = await requireAdminMfa();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
    }
    let eventId = null;
    try {
      const body = await request.json();
      if (body?.eventId != null) {
        if (typeof body.eventId !== 'string' || !UUID.test(body.eventId)) {
          return NextResponse.json({ error: 'Invalid eventId' }, { status: 400 });
        }
        eventId = body.eventId;
      }
    } catch {
      // No/invalid JSON body → full refresh (back-compat with the bare POST).
    }
    const result = await refreshMetrics(createAdminClient(), { eventId });
    return NextResponse.json({ success: true, via: 'admin', scope: eventId ? 'event' : 'all', ...result });
  } catch (err) {
    console.error('refresh-event-metrics (admin) error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 },
    );
  }
}

// GET /api/admin/refresh-event-metrics
// Scheduled (Vercel cron) refresh. Requires `Bearer ${CRON_SECRET}`.
export async function GET(request) {
  try {
    const via = classifyCronAuth(request.headers.get('authorization'), process.env.CRON_SECRET);
    if (via !== 'cron') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = await refreshMetrics(createAdminClient());
    return NextResponse.json({ success: true, via: 'cron', ...result });
  } catch (err) {
    console.error('refresh-event-metrics (cron) error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 },
    );
  }
}

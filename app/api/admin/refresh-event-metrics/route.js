import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildInternalMetricsSnapshot,
  buildPlaceholderMetricsRow,
} from '@/lib/event-analytics';
import { classifyCronAuth } from '@/lib/event-metrics-auth';

export const runtime = 'nodejs';

// Core refresh routine. Internal ticketing rows in public.event_ticket_metrics
// are re-aggregated from public.orders / public.tickets. Ticket Tailor rows are
// frozen historical records and are never re-pulled or overwritten.
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
  // Only internal-ticketing events are refreshed. Events still linked to a
  // Ticket Tailor series keep their frozen Ticket Tailor row even if their
  // ticketing mode is later changed.
  let query = supabase.from('events').select('id, title, tt_event_series_id, ticketing_mode');
  // Optional single-event scope. Used by the per-event "Refresh metrics" button
  // so an admin can update one row without re-pulling the whole portfolio.
  query = eventId
    ? query.eq('id', eventId)
    : query.order('event_date', { ascending: false }).limit(300);
  const { data: events, error } = await query;
  if (error) throw new Error('Failed to load events: ' + error.message);

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
    if (event.ticketing_mode === 'internal' && !event.tt_event_series_id) {
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

    // Ticket Tailor is retired and its cached rows are frozen. Anything that is
    // not internal ticketing is left exactly as it is: no external pull, no
    // placeholder overwrite. Past Ticket Tailor sales stay in the cache as the
    // permanent record for those events.
    skipped++;
  }

  if (rows.length) {
    const { error: upsertError } = await supabase
      .from('event_ticket_metrics')
      .upsert(rows, { onConflict: 'event_id' });
    if (upsertError) throw new Error('Failed to cache metrics: ' + upsertError.message);
  }

  return { refreshed, skipped, failed, total: rows.length, ticketTailorFrozen: true, fetchedAt };
}

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/admin/refresh-event-metrics
// Manual refresh by a signed-in admin. Internal ticketing only.
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

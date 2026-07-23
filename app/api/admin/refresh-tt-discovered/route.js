import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { listEvents, listOrders, listIssuedTickets } from '@/lib/tickettailor';
import {
  selectSeriesRepresentatives,
  buildDiscoveredIdentityRow,
  buildDiscoveredMetricsRow,
  buildDiscoveredPlaceholderRow,
  selectDiscoveredToRefresh,
} from '@/lib/tt-discovered-events';
import { classifyCronAuth } from '@/lib/event-metrics-auth';

export const runtime = 'nodejs';

// How many discovered series to pull income for in a single invocation. Keeps
// each run within serverless time / TicketTailor rate limits; the daily cron
// processes the stalest rows first, so all series are refreshed across runs
// (resumable). A one-time backfill can pass a larger `limit` (clamped below).
const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;

// Discover TicketTailor-only events and refresh their cached income. READ-ONLY
// against TicketTailor (listEvents / listOrders / listIssuedTickets). NEVER
// creates a website event and NEVER writes to TicketTailor — the only writes
// are upserts into our own public.tt_discovered_events cache. Local-event
// metrics (public.event_ticket_metrics) are untouched.
async function refreshDiscovered(supabase, { limit = DEFAULT_BATCH } = {}) {
  const batch = Math.min(MAX_BATCH, Math.max(1, Number(limit) || DEFAULT_BATCH));
  const ttConfigured = Boolean(process.env.TICKETTAILOR_API_KEY);
  const fetchedAt = new Date().toISOString();

  // Without a key we cannot list TicketTailor events at all — nothing to
  // discover. Report honestly rather than writing fabricated rows.
  if (!ttConfigured) {
    return { ttConfigured: false, discovered: 0, refreshed: 0, failed: 0, skipped: 0 };
  }

  // 1) Discover every TT event occurrence and collapse to one representative
  //    per series (income is pulled per series). One paginated list call.
  const rawEvents = await listEvents();
  const reps = selectSeriesRepresentatives(rawEvents);

  // 2) Map series → local event id so we can (a) tag rows already covered by a
  //    local event and (b) skip them in the income pass (event_ticket_metrics
  //    owns those). Only linked local events matter.
  const { data: localEvents, error: localErr } = await supabase
    .from('events')
    .select('id, tt_event_series_id')
    .not('tt_event_series_id', 'is', null);
  if (localErr) throw new Error('Failed to load local events: ' + localErr.message);
  const localBySeries = new Map();
  for (const ev of localEvents || []) {
    if (ev.tt_event_series_id) localBySeries.set(ev.tt_event_series_id, ev.id);
  }

  // 3) Identity upsert for all discovered series. Omits money/status columns so
  //    a conflict preserves income already pulled; new rows land as `pending`.
  const identityRows = reps.map((rep) =>
    buildDiscoveredIdentityRow(rep, { localEventId: localBySeries.get(rep.ttEventSeriesId) || null }),
  );
  if (identityRows.length) {
    const { error } = await supabase
      .from('tt_discovered_events')
      .upsert(identityRows, { onConflict: 'tt_event_series_id' });
    if (error) throw new Error('Failed to upsert discovered identities: ' + error.message);
  }

  // 4) Income pass: refresh the stalest TT-only series (never-fetched first),
  //    capped to `batch`. Read current rows to order by freshness + re-check
  //    linkage (a series may have just been linked to a local event).
  const { data: cacheRows, error: cacheErr } = await supabase
    .from('tt_discovered_events')
    .select('tt_event_series_id, fetched_at, local_event_id');
  if (cacheErr) throw new Error('Failed to load discovered cache: ' + cacheErr.message);

  const toRefresh = selectDiscoveredToRefresh(cacheRows || [], { limit: batch });

  const metricRows = [];
  let refreshed = 0;
  let failed = 0;
  for (const row of toRefresh) {
    const seriesId = row.tt_event_series_id;
    try {
      const [orders, issuedTickets] = await Promise.all([
        listOrders({ eventSeriesId: seriesId }),
        listIssuedTickets({ eventSeriesId: seriesId }),
      ]);
      metricRows.push(buildDiscoveredMetricsRow({ ttEventSeriesId: seriesId, orders, issuedTickets, fetchedAt }));
      refreshed++;
    } catch (err) {
      metricRows.push(
        buildDiscoveredPlaceholderRow({
          ttEventSeriesId: seriesId,
          status: 'error',
          source: 'tickettailor',
          errorDetail: String(err?.message || err).slice(0, 500),
          fetchedAt,
        }),
      );
      failed++;
    }
  }

  if (metricRows.length) {
    const { error } = await supabase
      .from('tt_discovered_events')
      .upsert(metricRows, { onConflict: 'tt_event_series_id' });
    if (error) throw new Error('Failed to cache discovered income: ' + error.message);
  }

  const linkedSkipped = (cacheRows || []).filter((r) => r.local_event_id).length;
  return {
    ttConfigured: true,
    discovered: reps.length,
    refreshed,
    failed,
    skipped: linkedSkipped,
    remaining: Math.max(0, ((cacheRows || []).filter((r) => !r.local_event_id).length) - refreshed - failed),
    batch,
    fetchedAt,
  };
}

// POST /api/admin/refresh-tt-discovered
// Manual discovery refresh by a signed-in admin (MFA-ready). Read-only against
// TicketTailor. Optional body { limit } scopes how many series to pull this run
// (clamped 1..100) — pass a larger value for a one-time backfill.
export async function POST(request) {
  try {
    const { unauthorized, reason } = await requireAdminMfa();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
    }
    let limit = DEFAULT_BATCH;
    try {
      const body = await request.json();
      if (body?.limit != null && Number.isFinite(Number(body.limit))) limit = Number(body.limit);
    } catch {
      // No/invalid JSON body → default batch.
    }
    const result = await refreshDiscovered(createAdminClient(), { limit });
    return NextResponse.json({ success: true, via: 'admin', ...result });
  } catch (err) {
    console.error('refresh-tt-discovered (admin) error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 },
    );
  }
}

// GET /api/admin/refresh-tt-discovered
// Scheduled (Vercel cron) discovery refresh. Requires `Bearer ${CRON_SECRET}`.
export async function GET(request) {
  try {
    const via = classifyCronAuth(request.headers.get('authorization'), process.env.CRON_SECRET);
    if (via !== 'cron') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const result = await refreshDiscovered(createAdminClient());
    return NextResponse.json({ success: true, via: 'cron', ...result });
  } catch (err) {
    console.error('refresh-tt-discovered (cron) error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 },
    );
  }
}

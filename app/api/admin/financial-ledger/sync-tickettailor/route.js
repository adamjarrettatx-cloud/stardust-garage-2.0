import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/manual-income';
import { ACCOUNT_NAMES, buildTicketTailorLedgerRows } from '@/lib/financial-ledger';
import { resolveAccountId, auditLedger } from '@/lib/financial-ledger-db';

export const runtime = 'nodejs';

// OWNER-ONLY: mirror the cached TicketTailor metrics into the unified cash-flow
// ledger.
//
// This route makes NO external API calls. It reads the existing read-only
// public.event_ticket_metrics cache (populated by /api/admin/refresh-event-metrics
// on a cron or on demand) and upserts one financial_transactions row per event
// that has real revenue. Re-running is idempotent: (source, external_ref) is
// unique, so a second run updates the existing row instead of duplicating it.
//
// Security posture matches /api/admin/manual-income: owner gate, same-origin
// check as CSRF defense-in-depth, service-role writes only after the gate, and
// created_by taken from the session rather than the body.
export async function POST(request) {
  try {
    if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
      return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
    }
    const { user, unauthorized } = await requireOwner();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const accountId = await resolveAccountId(supabase, ACCOUNT_NAMES.tickettailor);

    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('id, title, event_date, tt_event_series_id');
    if (eventsError) throw new Error(`Could not read events: ${eventsError.message}`);

    const { data: metrics, error: metricsError } = await supabase
      .from('event_ticket_metrics')
      .select('event_id, tt_event_series_id, tickets_sold, orders_count, gross_cents, fees_cents, net_cents, status, fetched_at')
      .limit(5000);
    if (metricsError) throw new Error(`Could not read event_ticket_metrics: ${metricsError.message}`);

    const { rows, skipped } = buildTicketTailorLedgerRows({
      events: events || [],
      metrics: metrics || [],
      accountId,
      createdBy: user.id,
    });

    if (rows.length) {
      const { error: upsertError } = await supabase
        .from('financial_transactions')
        .upsert(rows, { onConflict: 'source,external_ref' });
      if (upsertError) throw new Error(`Could not write the ledger: ${upsertError.message}`);
    }

    await auditLedger({
      admin: supabase,
      action: 'ledger_tickettailor_sync',
      user,
      request,
      details: { synced: rows.length, skipped },
    });

    return NextResponse.json({ success: true, synced: rows.length, skipped });
  } catch (err) {
    console.error('financial-ledger sync-tickettailor error:', err);
    return NextResponse.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}

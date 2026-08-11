import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { ownerPageGate } from '@/lib/auth-helpers';
import { buildFinancialOverview } from '@/lib/financial-overview';
import { buildAllSalesSeries, earliestWindowStartIso, fetchAllOrderPages } from '@/lib/ticket-sales-timeseries';
import FinancialsClient from './FinancialsClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Owner-only Financials page — the merged home for Event Analytics + the
// Financial Calendar. Access is gated server-side by ownerPageGate() (admin +
// owner email + MFA-ready), identical to both pages it replaces — the nav
// link is NOT the security boundary.
//
// This single route is now the canonical income accounting surface: it reads
// every income source (local TT-linked events, TicketTailor-only discovered
// events, and owner-entered manual income) and rolls them into ONE totals
// object via buildFinancialOverview(), fixing the gap where Event Analytics'
// totals silently excluded discovered + manual income while the Financial
// Calendar never surfaced fees/net at all.
export default async function FinancialsPage() {
  const { redirect: gate } = await ownerPageGate();
  if (gate) redirect(gate);

  // Gated above; this server component is never bundled to the browser, so we
  // read with the service-role client rather than depending on RLS to confine
  // rows (same pattern as the two pages this route replaces).
  const supabase = createAdminClient();

  // Fetch ALL events (no row cap) so the calendar can render every month —
  // capping (as the old Analytics page did with .limit(300)) silently drops
  // whole months once the catalog grows past the cap.
  const { data: events } = await supabase
    .from('events')
    .select('id, title, event_date, category, status, tt_event_series_id, member_discount_percent, discount_codes_generated')
    .order('event_date', { ascending: true });

  // Local member-discount-code rows power the engagement metrics.
  const { data: codes } = await supabase
    .from('member_discount_codes')
    .select('event_id, member_id, discount_percent, sent_at, send_scheduled_for')
    .limit(5000);

  // Cached TicketTailor metrics (populated by the read-only refresh route). The
  // table may not exist yet in a given environment — degrade gracefully to an
  // empty set so the page still renders local data.
  let metrics = [];
  const metricsRes = await supabase
    .from('event_ticket_metrics')
    .select('event_id, tt_event_series_id, tickets_sold, orders_count, gross_cents, fees_cents, net_cents, attendees_count, checkins_count, source, status, fetched_at')
    .limit(5000);
  if (!metricsRes.error && metricsRes.data) metrics = metricsRes.data;

  // TicketTailor-only events that were never mirrored onto the website (no
  // local events row). Populated by /api/admin/refresh-tt-discovered. Degrades
  // to an empty set if the cache table doesn't exist yet in this environment.
  let discovered = [];
  const discoveredRes = await supabase
    .from('tt_discovered_events')
    .select('tt_event_series_id, tt_event_id, title, event_date, tickets_sold, orders_count, gross_cents, fees_cents, net_cents, source, status, fetched_at, local_event_id')
    .limit(5000);
  if (!discoveredRes.error && discoveredRes.data) discovered = discoveredRes.data;

  // Owner-entered manual income (public.manual_income_entries): money with no
  // local event and no TicketTailor record (e.g. a venue rental). Owner-gated
  // above; degrade to empty if the table doesn't exist yet in this environment.
  let manual = [];
  const manualRes = await supabase
    .from('manual_income_entries')
    .select('id, entry_date, title, customer_name, event_name, category, amount_cents, notes, source, local_event_id, updated_at')
    .order('entry_date', { ascending: true })
    .limit(5000);
  if (!manualRes.error && manualRes.data) manual = manualRes.data;

  // Per-order TicketTailor rows for the sales-over-time chart. Bounded to the
  // widest default chart window rather than reading the whole table, and read
  // in pages: PostgREST caps a single response at the project's max-rows
  // setting, so one request would silently return only part of the window.
  const windowStartIso = earliestWindowStartIso();
  const orders = await fetchAllOrderPages({
    fetchPage: async ({ from, to }) => {
      const res = await supabase
        .from('ticket_order_attribution')
        .select('total_paid_cents, status, created_at, tt_created_at:raw_payload->>created_at')
        .gte('created_at', windowStartIso)
        .order('created_at', { ascending: true })
        .order('tt_order_id', { ascending: true })
        .range(from, to);

      if (res.error) {
        console.error('[financials] ticket_order_attribution read failed:', res.error.message);
        return [];
      }
      return res.data || [];
    },
  });

  const salesSeries = buildAllSalesSeries({ orders });

  const { entries, performanceRows, totals } = buildFinancialOverview({
    events: events || [],
    metrics,
    discovered,
    manual,
    codes: codes || [],
    today: new Date(),
  });

  return (
    <FinancialsClient
      entries={entries}
      performanceRows={performanceRows}
      totals={totals}
      salesSeries={salesSeries}
      todayIso={new Date().toISOString()}
    />
  );
}

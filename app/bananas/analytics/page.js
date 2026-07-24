import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { ownerPageGate } from '@/lib/auth-helpers';
import {
  buildEventPerformance,
  summarizePerformanceTotals,
} from '@/lib/event-analytics';
import AnalyticsClient from './AnalyticsClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const { redirect: gate } = await ownerPageGate();
  if (gate) redirect(gate);

  // Access is gated above by adminPageGate(); this is a server component that is
  // never bundled to the browser, so we read with the service-role client rather
  // than depending on RLS to confine rows.
  const supabase = createAdminClient();

  const { data: events } = await supabase
    .from('events')
    .select('id, title, event_date, category, tt_event_series_id, member_discount_percent, discount_codes_generated')
    .order('event_date', { ascending: false })
    .limit(300);

  // Local member-discount-code rows power the engagement metrics.
  const { data: codes } = await supabase
    .from('member_discount_codes')
    .select('event_id, member_id, discount_percent, sent_at, send_scheduled_for')
    .limit(5000);

  // Cached TicketTailor metrics (populated by the read-only refresh route). The
  // table may not exist yet in a given environment — degrade gracefully to an
  // empty set so the page still renders local member-code data.
  let metrics = [];
  const metricsRes = await supabase
    .from('event_ticket_metrics')
    .select('event_id, tt_event_series_id, tickets_sold, orders_count, gross_cents, fees_cents, net_cents, attendees_count, checkins_count, source, status, fetched_at')
    .limit(5000);
  if (!metricsRes.error && metricsRes.data) metrics = metricsRes.data;

  const rows = buildEventPerformance({ events: events || [], codes: codes || [], metrics });
  const totals = summarizePerformanceTotals(rows);

  const lastFetched = metrics
    .map((m) => m.fetched_at)
    .filter(Boolean)
    .sort()
    .pop() || null;

  const hasAnyMetrics = totals.eventsWithMetrics > 0;

  return (
    <AnalyticsClient
      rows={rows}
      totals={totals}
      lastFetched={lastFetched}
      hasAnyMetrics={hasAnyMetrics}
    />
  );
}

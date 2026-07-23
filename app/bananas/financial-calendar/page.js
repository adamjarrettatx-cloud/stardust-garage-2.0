import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { ownerPageGate } from '@/lib/auth-helpers';
import { buildFinancialCalendar } from '@/lib/financial-calendar';
import FinancialCalendarClient from './FinancialCalendarClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Owner-only Financial Calendar (MVP). Income-only, sourced from the existing
// read-only TicketTailor metrics cache. Access is gated server-side by
// ownerPageGate() (admin + owner email + MFA-ready), identical to the Event
// Analytics page — the nav link is NOT the security boundary.
export default async function FinancialCalendarPage() {
  const { redirect: gate } = await ownerPageGate();
  if (gate) redirect(gate);

  // Gated above; this server component is never bundled to the browser, so we
  // read with the service-role client rather than depending on RLS to confine
  // rows (same pattern as /bananas/analytics).
  const supabase = createAdminClient();

  // Fetch ALL events (no row cap), matching the Team Calendar this feature is
  // modeled on. A calendar must be able to render every month; capping the
  // result (previously .limit(500), ascending) returned only the earliest N
  // events, so once the catalog grew past the cap, whole months — including
  // recent/historical ones — silently rendered with no entries at all.
  const { data: events } = await supabase
    .from('events')
    .select('id, title, event_date, category, status, tt_event_series_id')
    .order('event_date', { ascending: true });

  // Cached TicketTailor metrics (populated by the read-only refresh route). The
  // table may not exist in a given environment — degrade gracefully to empty.
  let metrics = [];
  const metricsRes = await supabase
    .from('event_ticket_metrics')
    .select('event_id, tt_event_series_id, tickets_sold, orders_count, gross_cents, fees_cents, net_cents, source, status, fetched_at')
    .limit(5000);
  if (!metricsRes.error && metricsRes.data) metrics = metricsRes.data;

  // Build entries on the server so the client receives ready-to-render data and
  // never touches TicketTailor directly. `today` is resolved server-side.
  const entries = buildFinancialCalendar({
    events: events || [],
    metrics,
    today: new Date(),
  });

  return <FinancialCalendarClient entries={entries} todayIso={new Date().toISOString()} />;
}

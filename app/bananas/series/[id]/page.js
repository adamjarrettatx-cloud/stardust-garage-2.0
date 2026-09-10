import { notFound, redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import SeriesRollupClient from './SeriesRollupClient';

export const revalidate = 0;

export default async function SeriesRollupPage({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);
  const { id } = await params;
  const admin = createAdminClient();
  const { data: series, error } = await admin.from('event_series').select('*').eq('id', id).maybeSingle();
  if (error || !series) notFound();
  const { data: events } = await admin
    .from('events').select('id, title, event_date, event_time, status, recurrence_position')
    .eq('series_id', id).order('event_date');
  const eventIds = (events || []).map((event) => event.id);
  const { data: metrics } = eventIds.length
    ? await admin.from('event_ticket_metrics').select('event_id, tickets_sold, gross_cents, net_cents, attendees_count, checkins_count, status').in('event_id', eventIds)
    : { data: [] };
  return <SeriesRollupClient series={series} events={events || []} metrics={metrics || []} />;
}

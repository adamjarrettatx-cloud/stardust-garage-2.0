import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import EventForm from '../../components/EventForm';

export const revalidate = 0;

export default async function EditEventPage({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { id } = await params;
  const supabase = await createClient();
  const { data: event, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !event) {
    notFound();
  }

  // Cached metrics row (if any) so the editor can show when this event's sales
  // figures were last refreshed. Degrades gracefully if the table is absent.
  let metrics = null;
  const metricsRes = await supabase
    .from('event_ticket_metrics')
    .select('status, fetched_at, source')
    .eq('event_id', id)
    .maybeSingle();
  if (!metricsRes.error) metrics = metricsRes.data || null;

  return <EventForm event={event} metrics={metrics} />;
}

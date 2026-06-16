import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import CalendarClient from './CalendarClient';

export const revalidate = 0;

export default async function TeamCalendarPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();

  // Fetch website events (read-only, synced). Includes internal micro-party
  // events — the calendar distinguishes them via visibility/event_type. The
  // public /events page filters these out; the team calendar deliberately
  // shows them.
  const { data: publicEvents } = await supabase
    .from('events')
    .select('id, title, event_date, event_time, slug, visibility, event_type')
    .order('event_date', { ascending: true });

  // Fetch internal team events
  const { data: teamEvents } = await supabase
    .from('team_events')
    .select('*')
    .order('event_date', { ascending: true });

  return (
    <CalendarClient
      publicEvents={publicEvents || []}
      teamEvents={teamEvents || []}
    />
  );
}

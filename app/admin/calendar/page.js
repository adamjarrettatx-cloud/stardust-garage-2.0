import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import CalendarClient from './CalendarClient';

export const revalidate = 0;

export default async function TeamCalendarPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();

  // Fetch public events (read-only, synced)
  const { data: publicEvents } = await supabase
    .from('events')
    .select('id, title, event_date, event_time, slug')
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

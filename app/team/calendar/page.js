import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import TeamCalendarClient from './TeamCalendarClient';

export const revalidate = 0;

export default async function TeamCalendarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/team/login');

  // Get this user's team record
  const { data: teamMember } = await supabase
    .from('team_members')
    .select('id, full_name, role, email')
    .eq('user_id', user.id)
    .single();

  if (!teamMember) redirect('/team/login');

  // Website events (read-only). Includes internal micro-party events so the
  // team can see them on the calendar; they are visually distinguished and are
  // never shown on the public /events page.
  const { data: publicEvents } = await supabase
    .from('events')
    .select('id, title, event_date, event_time, slug, visibility, event_type')
    .order('event_date', { ascending: true });

  // Team events — RLS already filters to readable ones
  const { data: teamEvents } = await supabase
    .from('team_events')
    .select('*')
    .order('event_date', { ascending: true });

  return (
    <TeamCalendarClient
      publicEvents={publicEvents || []}
      teamEvents={teamEvents || []}
      currentUserId={user.id}
      currentUserName={teamMember.full_name || teamMember.email}
    />
  );
}

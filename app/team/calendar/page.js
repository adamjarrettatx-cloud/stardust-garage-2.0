import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { totalUnreadCount } from '@/lib/chat';
import CalendarClient from './CalendarClient';

export const revalidate = 0;

// Unified Team Calendar — reachable by both admins and team members. Role
// comes from the server-verified team_members table (never trusted from the
// client). The query itself is identical for both roles; RLS on team_events
// already scopes what each role is permitted to read, so there is no risk of
// fetching admin-only data and hiding it client-side.
export default async function TeamCalendarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Get this user's team record
  const { data: teamMember } = await supabase
    .from('team_members')
    .select('id, full_name, role, email')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!teamMember) redirect('/login');

  const isAdmin = teamMember.role === 'admin';

  // Creator name lookup for the "Created by" labels + monthly scorecard.
  // RLS on team_members only lets admins select every row (team members can
  // only read their own), so this map is only meaningfully populated for
  // admins — which matches where these features are surfaced in the UI.
  let creatorNames = {};
  if (isAdmin) {
    const { data: allTeamMembers } = await supabase
      .from('team_members')
      .select('user_id, full_name, email');
    (allTeamMembers || []).forEach((tm) => {
      if (tm.user_id) creatorNames[tm.user_id] = tm.full_name || tm.email;
    });
  }

  // Website events (read-only). Includes internal micro-party events so the
  // team can see them on the calendar; they are visually distinguished and are
  // never shown on the public /events page.
  const { data: publicEvents } = await supabase
    .from('events')
    .select('id, title, event_date, event_time, slug, visibility, event_type')
    .order('event_date', { ascending: true });

  // Team events — RLS already scopes this to everything for admins, and to
  // the caller's readable set for team members.
  const { data: teamEvents } = await supabase
    .from('team_events')
    .select('*')
    .order('event_date', { ascending: true });

  // Unread Team Chat messages, so the CHAT link can carry a count. Scoped to
  // the caller by the RPC itself — it takes no arguments.
  const { data: unreadRows } = await supabase.rpc('chat_unread_counts');

  return (
    <CalendarClient
      publicEvents={publicEvents || []}
      teamEvents={teamEvents || []}
      isAdmin={isAdmin}
      currentUserId={user.id}
      currentUserName={teamMember.full_name || teamMember.email}
      creatorNames={creatorNames}
      chatUnreadCount={totalUnreadCount(unreadRows)}
    />
  );
}

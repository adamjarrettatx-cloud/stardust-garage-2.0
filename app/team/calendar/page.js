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

  // Creator name lookup for the leaderboard (all roles) + admin-only "Created
  // by" labels. Direct SELECT on team_members is admin-only / own-row-only
  // (see 20260727_rls_security_hardening.sql), so names come from the
  // team_creator_names() RPC, which is SECURITY DEFINER and available to any
  // team member (see 20260730_team_event_leaderboard_rpc.sql).
  const { data: allCreatorNames } = await supabase.rpc('team_creator_names');
  const creatorNames = {};
  (allCreatorNames || []).forEach((row) => {
    if (row.user_id) creatorNames[row.user_id] = row.display_name;
  });

  // Website events (read-only). Includes internal micro-party events so the
  // team can see them on the calendar; they are visually distinguished and are
  // never shown on the public /events page.
  const { data: publicEvents } = await supabase
    .from('events')
    .select('id, title, event_date, event_time, slug, visibility, event_type, status')
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

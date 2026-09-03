import { totalUnreadCount } from '@/lib/chat';

// ---------------------------------------------------------------------------
// Events Calendar data
// ---------------------------------------------------------------------------
// The Events Calendar renders in two places now — at the top of the Events
// section of the admin dashboard (app/bananas/EventsTabPanel.js) and as the
// standalone /team/calendar page a non-admin team member lands on. Both need
// the identical dataset, so the queries live here instead of being duplicated
// (and drifting) in two server components.
//
// Nothing here is a permission check. Role is read from the server-verified
// team_members table purely so the UI knows which affordances to show; RLS on
// team_events already scopes what each caller may read, and every write goes
// back through the same policies.
//
// Returns null when the caller has no team record — the callers decide what to
// do about that (redirect to /login), because a page and a dashboard section
// handle it differently.
export async function loadEventsCalendarData(supabase) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: teamMember } = await supabase
    .from('team_members')
    .select('id, full_name, role, email')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!teamMember) return null;

  const isAdmin = teamMember.role === 'admin';

  // Creator name lookup for the monthly scorecard (all roles) + admin-only
  // "Created by" labels. Direct SELECT on team_members is admin-only /
  // own-row-only (see 20260727_rls_security_hardening.sql), so names come from
  // the team_creator_names() RPC, which is SECURITY DEFINER and available to
  // any team member (see 20260730_team_event_leaderboard_rpc.sql).
  const { data: allCreatorNames } = await supabase.rpc('team_creator_names');
  const creatorNames = {};
  (allCreatorNames || []).forEach((row) => {
    if (row.user_id) creatorNames[row.user_id] = row.display_name;
  });

  // Website events (read-only on the calendar). Includes internal micro-party
  // events so the whole programming picture is in one grid; they are visually
  // distinguished and are never shown on the public /events page.
  const { data: publicEvents } = await supabase
    .from('events')
    .select('id, title, event_date, event_time, slug, visibility, event_type, status, category')
    .order('event_date', { ascending: true });

  // Which public events have a signed AND uploaded contract on file. Used to
  // render a black left-edge stripe on those tiles; anything else gets no
  // stripe. Only fetched for the events we actually just loaded.
  //
  // document_contracts SELECT is admin-only via RLS (see the
  // contracts_admin_select policy), so non-admin team members never get a
  // populated set — their calendar simply doesn't render a stripe, which is
  // fine (contract status is admin business).
  //
  // A contract counts as "signed and uploaded" when its status is 'signed'
  // AND its linked document has at least one uploaded version on file. That
  // covers both SignNow-auto-archived signed PDFs and manually uploaded ones.
  const publicEventIds = (publicEvents || []).map((e) => e.id);
  let publicEventsWithSignedContract = new Set();
  if (isAdmin && publicEventIds.length > 0) {
    const { data: contractRows } = await supabase
      .from('document_contracts')
      .select('event_id, document_id, status')
      .eq('status', 'signed')
      .in('event_id', publicEventIds);
    const docIds = Array.from(new Set((contractRows || []).map((r) => r.document_id).filter(Boolean)));
    let docsWithFile = new Set();
    if (docIds.length > 0) {
      const { data: versionRows } = await supabase
        .from('document_versions')
        .select('document_id')
        .in('document_id', docIds);
      docsWithFile = new Set((versionRows || []).map((v) => v.document_id));
    }
    for (const row of contractRows || []) {
      if (row.event_id && row.document_id && docsWithFile.has(row.document_id)) {
        publicEventsWithSignedContract.add(row.event_id);
      }
    }
  }

  // Internal calendar entries — RLS already scopes this to everything for
  // admins, and to the caller's readable set for team members.
  const { data: teamEvents } = await supabase
    .from('team_events')
    .select('*')
    .order('event_date', { ascending: true });

  // Unread Team Chat messages, so the standalone page's CHAT link can carry a
  // count. Scoped to the caller by the RPC itself — it takes no arguments.
  const { data: unreadRows } = await supabase.rpc('chat_unread_counts');

  return {
    isAdmin,
    publicEvents: publicEvents || [],
    teamEvents: teamEvents || [],
    publicEventsWithSignedContract: Array.from(publicEventsWithSignedContract),
    currentUserId: user.id,
    currentUserName: teamMember.full_name || teamMember.email,
    creatorNames,
    chatUnreadCount: totalUnreadCount(unreadRows),
  };
}


import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { canCreateChatChannel, canModerateChat } from '@/lib/chat';
import TeamChatClient from './TeamChatClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Team chat surface. Auth + staff gating happen here; all message data loading
// and realtime subscriptions live in the client component (RLS confines reads
// to channels the caller belongs to). The chat backend — tables, RLS, the
// get_or_create_dm RPC and the chat-notify Edge Function — is already deployed.
export default async function TeamChatPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/team/login');

  const { data: teamMember } = await supabase
    .from('team_members')
    .select('id, full_name, email, role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!teamMember) redirect('/team/login');

  return (
    <TeamChatClient
      currentUserId={user.id}
      currentUserName={teamMember.full_name || teamMember.email}
      canCreateChannel={canCreateChatChannel({ role: teamMember.role, email: user.email })}
      // Owner-only moderation: delete any message (anyone's, channel or DM) and
      // delete a group channel. Computed on the server from the team_members row
      // rather than anything the browser could set.
      canModerate={canModerateChat({ role: teamMember.role, email: user.email })}
      // Decides where a #event link in a message points. Admins reach the
      // dashboard page; everyone else can only be sent to the public
      // /events/[slug] page, because /bananas/* is admin-gated by middleware and
      // linking a non-admin there would bounce them. See lib/linked-event-link.js.
      isAdmin={teamMember.role === 'admin'}
    />
  );
}

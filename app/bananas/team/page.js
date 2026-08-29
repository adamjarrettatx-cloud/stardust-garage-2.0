import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ownerPageGate } from '@/lib/auth-helpers';
import TeamManagementClient from './TeamManagementClient';

export const revalidate = 0;

// Owner-only. Team management creates/removes logins and changes roles, so it
// is gated to the owner email — a non-owner admin who knows this URL is bounced
// back to /bananas rather than being served the member list.
export default async function TeamManagementPage() {
  const { redirect: gate } = await ownerPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();

  const { data: members } = await supabase
    .from('team_members')
    .select('*')
    .order('created_at', { ascending: true });

  return <TeamManagementClient members={members || []} />;
}

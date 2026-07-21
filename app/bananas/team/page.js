import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import TeamManagementClient from './TeamManagementClient';

export const revalidate = 0;

export default async function TeamManagementPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();

  const { data: members } = await supabase
    .from('team_members')
    .select('*')
    .order('created_at', { ascending: true });

  return <TeamManagementClient members={members || []} />;
}

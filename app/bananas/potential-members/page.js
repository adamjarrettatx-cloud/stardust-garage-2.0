import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import PotentialMembersClient from './PotentialMembersClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function PotentialMembersPage() {
  // Defense-in-depth: middleware already gates /bananas/*, but verify here too.
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();

  // RLS confines this to admin-readable rows automatically (public.is_admin()).
  const { data: potentialMembers } = await supabase
    .from('potential_members')
    .select(`
      id, full_name, phone, email, notes, status,
      added_by, converted_member_id, created_at, updated_at,
      added_by_team_member:added_by ( id, full_name, email )
    `)
    .order('created_at', { ascending: false });

  return <PotentialMembersClient potentialMembers={potentialMembers || []} />;
}

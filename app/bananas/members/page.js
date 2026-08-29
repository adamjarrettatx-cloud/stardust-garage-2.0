import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import MembersListClient from './MembersListClient';

export const revalidate = 0;

// Fetch-only server page. All rendering, filtering and the Active /
// Inactive-Pending tab state live in MembersListClient, because tab selection
// needs client state.
export default async function AdminMembersPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();

  const { data: members } = await supabase
    .from('member_profiles')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <>
      <AuthenticatedPageHeader
        title="Members"
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-8"
      />

      <MembersListClient members={members || []} />
    </>
  );
}

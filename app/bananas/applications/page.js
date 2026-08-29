import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import ApplicationsList from './ApplicationsList';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;

export default async function ApplicationsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: applications } = await supabase
    .from('membership_applications')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <>
      <AuthenticatedPageHeader
        title="Membership Applications"
        description="Applications submitted through the Members page."
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-10"
      />

      <ApplicationsList applications={applications || []} />
    </>
  );
}

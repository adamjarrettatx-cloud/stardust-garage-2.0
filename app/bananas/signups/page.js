import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import { markNewSignupsSeen } from '@/lib/signups-seen';
import { buildSignupsCsv } from '@/lib/signups';
import SignupsClient from './SignupsClient';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;

export default async function SignupsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: signups } = await supabase
    .from('signups')
    .select('*')
    .order('created_at', { ascending: false });

  // Signups only: this load acknowledges the list. The rows fetched above still
  // render as New for this request, and show up under Seen from the next load
  // onward. Signups have no manual action, so unlike the other submission
  // types, viewing them is the transition.
  await markNewSignupsSeen();

  const csvContent = buildSignupsCsv(signups);
  const csvHref = csvContent
    ? `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`
    : '';

  return (
    <>
      <AuthenticatedPageHeader
        title="Signups"
        description="People who signed up via “Stay in the loop” on the homepage, plus first-time guests who signed a consent form at the door."
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-10"
      />
      <SignupsClient signups={signups || []} csvHref={csvHref} />
    </>
  );
}

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import { markNewSignupsSeen } from '@/lib/signups-seen';
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

  const downloadCsv = () => {
    if (!signups || signups.length === 0) return '';
    const header = 'Contact,Type,Source,Signed Up At\n';
    const rows = signups
      .map((s) => `"${s.contact}","${s.contact_type || ''}","${s.source || ''}","${s.created_at}"`)
      .join('\n');
    return header + rows;
  };

  const csvContent = downloadCsv();
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csvContent)}`;

  return (
    <main className="max-w-[1100px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        backHref="/bananas"
        backLabel="← BACK TO ADMIN"
        title="Signups"
        description="People who signed up via “Stay in the loop” on the homepage."
        titleClassName="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      />
      <SignupsClient signups={signups || []} csvHref={csvHref} />
    </main>
  );
}

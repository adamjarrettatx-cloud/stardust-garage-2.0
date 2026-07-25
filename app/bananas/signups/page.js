import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import SignupsClient from './SignupsClient';
import {
  AuthenticatedPageHeader,
  AuthenticatedPageSurface,
} from '@/app/components/AuthenticatedPageTheme';

export const revalidate = 0;

export default async function SignupsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: signups } = await supabase
    .from('signups')
    .select('*')
    .order('created_at', { ascending: false });

  const total = signups?.length || 0;

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
    <AuthenticatedPageSurface
      scope="admin"
      width="max-w-[1100px]"
      className="transition-colors duration-150"
      testId="route-bananas-signups"
    >
      <AuthenticatedPageHeader
        scope="admin"
        backHref="/bananas"
        title="Signups"
        subtitle='People who signed up via "Stay in the loop" on the homepage.'
        titleClassName="text-[40px]"
      />
      <SignupsClient signups={signups || []} csvHref={csvHref} />
    </AuthenticatedPageSurface>
  );
}

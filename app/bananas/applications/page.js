import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import ApplicationsList from './ApplicationsList';
import {
  AuthenticatedPageHeader,
  AuthenticatedPageSurface,
} from '@/app/components/AuthenticatedPageTheme';

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
    <AuthenticatedPageSurface
      scope="admin"
      width="max-w-[1200px]"
      className="transition-colors duration-150"
      testId="route-bananas-applications"
    >
      <AuthenticatedPageHeader
        scope="admin"
        backHref="/bananas"
        title="Membership Applications"
        subtitle="Applications submitted through the Members page."
        titleClassName="text-[40px]"
      />
      <ApplicationsList applications={applications || []} />
    </AuthenticatedPageSurface>
  );
}

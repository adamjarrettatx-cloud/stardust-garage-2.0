import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import CollaborationsList from './CollaborationsList';
import {
  AuthenticatedPageHeader,
  AuthenticatedPageSurface,
} from '@/app/components/AuthenticatedPageTheme';

export const revalidate = 0;

export default async function CollaborationsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: collabs } = await supabase
    .from('collaborations')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <AuthenticatedPageSurface
      scope="admin"
      width="max-w-[1200px]"
      className="transition-colors duration-150"
      testId="route-bananas-collaborations"
    >
      <AuthenticatedPageHeader
        scope="admin"
        backHref="/bananas"
        title="Collaborations"
        subtitle="Submissions from the Collaborate page (DJs and Artists)."
        titleClassName="text-[40px]"
      />
      <CollaborationsList collabs={collabs || []} />
    </AuthenticatedPageSurface>
  );
}

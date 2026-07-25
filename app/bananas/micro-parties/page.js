import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import MicroPartiesList from './MicroPartiesList';
import {
  AuthenticatedPageHeader,
  AuthenticatedPageSurface,
} from '@/app/components/AuthenticatedPageTheme';

export const revalidate = 0;

export default async function MicroPartyInquiriesPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: inquiries } = await supabase
    .from('micro_party_inquiries')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <AuthenticatedPageSurface
      scope="admin"
      width="max-w-[1200px]"
      className="transition-colors duration-150"
      testId="route-bananas-micro-parties"
    >
      <AuthenticatedPageHeader
        scope="admin"
        backHref="/bananas"
        title="Micro Party Inquiries"
        subtitle="Inquiries submitted through the Micro Parties / Birthdays form."
        titleClassName="text-[40px]"
      />
      <MicroPartiesList inquiries={inquiries || []} />
    </AuthenticatedPageSurface>
  );
}

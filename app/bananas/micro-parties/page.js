import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import MicroPartiesList from './MicroPartiesList';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

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
    <main className="max-w-[1200px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        backHref="/bananas"
        backLabel="← BACK TO ADMIN"
        title="Micro Party Inquiries"
        description="Inquiries submitted through the Micro Parties / Birthdays form."
        titleClassName="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      />

      <MicroPartiesList inquiries={inquiries || []} />
    </main>
  );
}

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import VenueInquiriesList from './VenueInquiriesList';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;

export default async function VenueInquiriesPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const { data: inquiries } = await supabase
    .from('venue_inquiries')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        backHref="/bananas"
        backLabel="← BACK TO ADMIN"
        title="Venue Inquiries"
        description="Inquiries submitted through the Venue Rental page."
        titleClassName="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      />

      <VenueInquiriesList inquiries={inquiries || []} />
    </main>
  );
}

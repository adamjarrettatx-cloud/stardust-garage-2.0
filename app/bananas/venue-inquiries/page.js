import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import VenueInquiriesList from './VenueInquiriesList';
import {
  AuthenticatedPageHeader,
  AuthenticatedPageSurface,
} from '@/app/components/AuthenticatedPageTheme';

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
    <AuthenticatedPageSurface
      scope="admin"
      width="max-w-[1200px]"
      className="transition-colors duration-150"
      testId="route-bananas-venue-inquiries"
    >
      <AuthenticatedPageHeader
        scope="admin"
        backHref="/bananas"
        title="Venue Inquiries"
        subtitle="Inquiries submitted through the Venue Rental page."
        titleClassName="text-[40px]"
      />
      <VenueInquiriesList inquiries={inquiries || []} />
    </AuthenticatedPageSurface>
  );
}

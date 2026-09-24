import { redirect } from 'next/navigation';
import { requirePartner } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { profileCapabilities } from '@/lib/profile-capabilities';
import './events.css';
import EventList from './EventList';
export const dynamic = 'force-dynamic';
export default async function MyEventsPage() {
  const { partner, unauthorized } = await requirePartner();
  if (unauthorized) redirect('/portal/login');
  if (!profileCapabilities(partner.contact_type).events) redirect('/account/profile');
  const db = await createClient();
  const { data, error } = await db.rpc('partner_my_events');
  return <EventList events={data || []} error={Boolean(error)} />;
}

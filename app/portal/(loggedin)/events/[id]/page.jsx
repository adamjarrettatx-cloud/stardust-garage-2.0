import { redirect, notFound } from 'next/navigation';
import { requirePartner } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { profileCapabilities } from '@/lib/profile-capabilities';
import EventSales from '../EventSales';
import '../events.css';
export const dynamic = 'force-dynamic';
export default async function EventSalesPage({ params }) {
  const { partner, unauthorized } = await requirePartner();
  if (unauthorized) redirect('/portal/login');
  if (!profileCapabilities(partner.contact_type).events) notFound();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const db = await createClient();
  const { data, error } = await db.rpc('partner_event_sales', { p_event_id: id });
  if (error?.code === 'P0002') notFound();
  if (error || !data) throw new Error('Event sales could not be loaded. Please try again.');
  return <EventSales initial={data} />;
}

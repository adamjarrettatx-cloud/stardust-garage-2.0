import { redirect, notFound } from 'next/navigation';
import { requirePartner } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { partnerCanViewEvents } from '@/lib/profile-capabilities';
import EventSales from '../EventSales';
import '../events.css';
export const dynamic = 'force-dynamic';
export default async function EventSalesPage({ params }) {
  const { partner, unauthorized } = await requirePartner();
  if (unauthorized) redirect('/portal/login');
  if (!partnerCanViewEvents(partner)) notFound();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const db = await createClient();
  const [sales, roster, writeup] = await Promise.all([
    db.rpc('partner_event_sales', { p_event_id: id }),
    db.rpc('partner_event_attendees', { p_event_id: id }),
    db.rpc('partner_event_writeup', { p_event_id: id }),
  ]);
  const error = sales.error || roster.error;
  if (error?.code === 'P0002') notFound();
  if (error || !sales.data) throw new Error('Event sales could not be loaded. Please try again.');
  return <EventSales initial={{ ...sales.data, attendees: roster.data?.attendees || [], writeup: writeup.error ? null : writeup.data }} />;
}

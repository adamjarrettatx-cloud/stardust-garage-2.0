import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import EventAttendeesClient from '../events/[id]/attendees/EventAttendeesClient';

export const dynamic = 'force-dynamic';

export default async function OrdersPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);
  return <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px' }}><EventAttendeesClient /></div>;
}

import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import AdminTicketsClient from './AdminTicketsClient';

// /admin/tickets/[eventId] — single-page admin console for one event's
// internal ticketing: sales summary, products + inventory, orders list,
// per-order refund/void/comp actions.
export const dynamic = 'force-dynamic';

export default async function AdminEventTicketsPage({ params }) {
  if (!isInternalTicketingEnabled()) redirect('/admin');
  const gate = await requireAdmin();
  if (gate.unauthorized) redirect('/login?next=/admin');
  const { eventId } = await params;

  return (
    <main style={{ maxWidth: 1100, margin: '24px auto', padding: '0 20px' }}>
      <h1>Ticketing — Event {eventId.slice(0, 8)}…</h1>
      <AdminTicketsClient eventId={eventId} />
    </main>
  );
}

import { createAdminClient } from '@/lib/supabase/admin';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { loadDoorEvents } from '@/lib/events/door-events-server';
import DoorTickets from './DoorTickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = {
  title: 'Door Tickets | Stardust Garage',
  description: 'Buy tickets for the current event at Stardust Garage.',
  robots: { index: false, follow: true },
};

export default async function DoorPage() {
  let initial = null;
  try {
    initial = await loadDoorEvents(createAdminClient(), { ticketingEnabled: isInternalTicketingEnabled() });
  } catch { /* Recover through the client retry without ever showing a stale event. */ }
  return <DoorTickets initial={initial} />;
}

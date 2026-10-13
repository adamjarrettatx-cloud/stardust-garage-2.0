import { redirect } from 'next/navigation';

// Retired. The old per-event ticket console's sales totals live on Sales and
// the Tax Report, products and inventory on the event's Ticketing panel, and
// orders, refunds, resends and comps on Attendees & Orders. Old bookmarks
// land on Attendees & Orders, which applies its own admin gate.
export const dynamic = 'force-dynamic';

export default async function RetiredAdminEventTicketsPage({ params }) {
  const { eventId } = await params;
  redirect(`/bananas/events/${encodeURIComponent(eventId)}/attendees`);
}

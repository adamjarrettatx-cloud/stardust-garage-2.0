import { redirect } from 'next/navigation';

/**
 * Old per-event detail pages have been retired. Tickets and event details
 * now live on Ticket Tailor. Anyone hitting an old slug URL gets bounced
 * to the events index, which embeds the live box office.
 */
export default function LegacyEventSlugPage() {
  redirect('/events');
}

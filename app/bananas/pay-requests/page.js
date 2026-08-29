import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import PayRequestsClient from './PayRequestsClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

function formatEventDate(dateString) {
  if (!dateString) return 'Date TBC';
  return new Date(dateString + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Artist / DJ Pay System — Phase 3: Review & Pay + 1099 tracking.
//
// All the actual data loading and mutation (approve/reject/reopen) happens
// client-side through adminFetch, same split as ArtistLineupPanel: this file
// is only the server-side auth gate + page chrome.
//
// ?event=<id> scopes the review queue to one event. That is how this page is
// normally reached — from the ARTIST PAY button on the event's row in the
// Events list — so the header names the event instead of making you scan a
// mixed queue for it. The event title is resolved here rather than read off a
// request row so the page can still say which event it is showing when that
// event has no requests yet. Without the param the page behaves as before and
// shows every request.
export default async function PayRequestsPage({ searchParams }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const params = await searchParams;
  const raw = params?.event;
  const eventId = (Array.isArray(raw) ? raw[0] : raw) || null;

  let event = null;
  if (eventId) {
    const admin = createAdminClient();
    const { data } = await admin
      .from('events')
      .select('id, title, event_date')
      .eq('id', eventId)
      .maybeSingle();
    event = data || null;
  }

  return (
    <>
      <AuthenticatedPageHeader
        backHref={event ? `/bananas?tab=events` : null}
        backLabel={event ? '← BACK TO EVENTS' : null}
        title="Artist Pay"
        description={
          event
            ? `${event.title || 'Untitled event'} · ${formatEventDate(event.event_date)} — pay requests for this event only.`
            : 'Review pay requests and track cumulative pay per contractor.'
        }
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-10"
      />
      <PayRequestsClient
        eventId={eventId}
        eventTitle={eventId ? event?.title || null : null}
        eventMissing={Boolean(eventId) && !event}
      />
    </>
  );
}

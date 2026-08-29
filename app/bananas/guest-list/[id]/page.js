import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import GuestListPanel from './GuestListPanel';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// One event's guest list, start to finish: the roll-up, the grant form, every
// host's allocation and every named guest under it.
//
// Owner decision 2026-08-29: clicking GUEST LIST on an event row lands here and
// the work is done here. It used to be a read-only breakdown that sent you to a
// panel buried at the bottom of the event edit form to change anything, which
// meant two screens and a scroll for one job. The editing panel now lives on
// this route and the event form links to it instead of duplicating it.
//
// The page itself stays deliberately thin: only the event name and date are
// server-rendered, because everything else has to stay live as grants are added,
// edited and revoked without a reload.

function formatEventDate(dateString) {
  if (!dateString) return 'Date TBC';
  return new Date(dateString + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function EventGuestListPage({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { id } = await params;
  const admin = createAdminClient();

  const { data: event } = await admin
    .from('events')
    .select('id, title, event_date')
    .eq('id', id)
    .maybeSingle();
  if (!event) notFound();

  return (
    <div className="max-w-[1000px]">
      <AuthenticatedPageHeader
        backHref="/bananas?tab=events"
        backLabel="← BACK TO EVENTS"
        title={event.title || 'Untitled event'}
        description={`Guest list · ${formatEventDate(event.event_date)}`}
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        className="mb-10"
      >
        {/* The way to the rest of the event, since the guest list no longer
            lives inside that form. */}
        <Link
          href={`/bananas/events/${event.id}`}
          className="auth-theme-border-button px-4 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors"
          style={{ color: 'var(--auth-accent)' }}
        >
          EVENT DETAILS
        </Link>
      </AuthenticatedPageHeader>

      <GuestListPanel eventId={event.id} />
    </div>
  );
}

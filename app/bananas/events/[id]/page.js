import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import EventForm from '../../components/EventForm';
import PublishEventButton from '../../components/PublishEventButton';
import ArtistLineupPanel from './ArtistLineupPanel';
import GuestListPanel from '../../components/GuestListPanel';
import EventContractsPanel from './EventContractsPanel';
import { organizerDisplayLabel } from '@/lib/event-organizer';

export const revalidate = 0;

export default async function EditEventPage({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { id } = await params;
  const supabase = await createClient();
  const { data: event, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !event) {
    notFound();
  }

  // Cached metrics row (if any) so the editor can show when this event's sales
  // figures were last refreshed. Degrades gracefully if the table is absent.
  let metrics = null;
  const metricsRes = await supabase
    .from('event_ticket_metrics')
    .select('status, fetched_at, source')
    .eq('event_id', id)
    .maybeSingle();
  if (!metricsRes.error) metrics = metricsRes.data || null;

  // The event's counterparty profile, so the editor can link straight to the
  // Event Organizer it belongs to. Read through the caller's session (RLS), and
  // a failure here must not take the event editor down — the Contracts panel
  // below loads the authoritative copy through its own gated API.
  let organizer = null;
  if (event.contact_id) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, display_name, legal_name')
      .eq('id', event.contact_id)
      .maybeSingle();
    organizer = contact || null;
  }

  return (
    <EventForm
      event={event}
      metrics={metrics}
      headerActions={(
        <>
          {organizer && (
            <Link
              href={`/bananas/contacts/${organizer.id}`}
              className="auth-theme-border-button px-4 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors"
              style={{ color: 'var(--auth-accent)' }}
              title={`Event Organizer: ${organizerDisplayLabel(organizer)}`}
            >
              {/* Truncated so a long legal name can't blow out the header pill —
                  the full name is in the title attribute and on the panel below. */}
              ORGANIZER: {(organizerDisplayLabel(organizer) || '').toUpperCase().slice(0, 28)}
              {organizerDisplayLabel(organizer).length > 28 ? '…' : ''}
            </Link>
          )}
          <Link
            href={`/bananas/events/${event.id}/financials`}
            className="auth-theme-border-button px-4 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors"
            style={{ color: 'var(--auth-accent)' }}
          >
            FINANCIALS
          </Link>
        </>
      )}
      statusPanel={(
        <PublishEventButton
          eventId={event.id}
          status={event.status}
          ttEventSeriesId={event.tt_event_series_id}
        />
      )}
      footerPanels={(
        <>
          <ArtistLineupPanel eventId={event.id} />
          <EventContractsPanel eventId={event.id} />
          {/* Also a full screen of its own at /bananas/guest-list/<id>, which is
              where the Events row's GUEST LIST button goes. Same component in
              both places, so allocations can be sorted out mid-event-edit
              without the two views drifting apart. */}
          <div className="mt-8">
            <GuestListPanel eventId={event.id} />
          </div>
        </>
      )}
    />
  );
}

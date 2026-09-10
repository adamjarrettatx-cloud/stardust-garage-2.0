import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import EventForm from '../../components/EventForm';
import PublishEventButton from '../../components/PublishEventButton';
import ArtistLineupPanel from './ArtistLineupPanel';
import EventContractsPanel from './EventContractsPanel';
import TicketingPanel from './TicketingPanel';
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
    .select('status, fetched_at, source, orders_count')
    .eq('event_id', id)
    .maybeSingle();
  if (!metricsRes.error) metrics = metricsRes.data || null;

  let series = null;
  if (event.series_id) {
    const { data } = await supabase.from('event_series').select('id, recurrence_freq, starts_on, ends_on').eq('id', event.series_id).maybeSingle();
    series = data || null;
  }

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
      event={{ ...event, series }}
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
          {event.series_id && (
            <Link
              href={`/bananas/series/${event.series_id}`}
              className="auth-theme-border-button px-4 py-2.5 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors"
              style={{ color: 'var(--auth-accent)' }}
            >
              VIEW SERIES ROLLUP
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
          slug={event.slug}
          status={event.status}
          ttEventSeriesId={event.tt_event_series_id}
        />
      )}
      footerPanels={(
        <>
          <ArtistLineupPanel eventId={event.id} />
          <TicketingPanel
            eventId={event.id}
            initialMode={event.ticketing_mode}
            initialTicketUrl={event.ticket_url}
            initialTtSeriesId={event.tt_event_series_id}
            initialBookingFeeCentsDefault={event.booking_fee_cents_default ?? 295}
            // Keyed by column name so the panel can seed one box per
            // membership straight from lib/membership-tiers.js.
            initialMemberDiscounts={{
              member_discount_percent_trial: event.member_discount_percent_trial ?? null,
              member_discount_percent_weekender: event.member_discount_percent_weekender ?? null,
              member_discount_percent_cowork: event.member_discount_percent_cowork ?? null,
              member_discount_percent_iykyk: event.member_discount_percent_iykyk ?? null,
            }}
            initialIsWeekendMusicExperience={!!event.is_weekend_music_experience}
            // Event start date + free-text start time. The ticketing panel uses
            // these to render the 'Ticket Sales End … hours after doors open'
            // dropdown and to compute the persisted `sales_end_at` timestamp.
            // event_time is free text (e.g. '10:00 PM'); the panel parses only
            // the simple clock shapes and hides the dropdown for anything else.
            eventDate={event.event_date || null}
            eventStartTime={event.event_time || null}
          />
          {/* Contracts section is hidden entirely for SDG-only events
              (Organizer = "SDG Only") because those events have no
              counterparty to sign anything — nothing to draft, nothing
              to send, nothing to archive. `id="contracts"` is the
              scroll target for the Events list row's CONTRACTS button
              (app/bananas/components/EventsSection.js). Kept on a
              wrapper here so EventContractsPanel stays self-contained
              and other callers don't inherit a page-level anchor.
              Deep-links to #contracts on an SDG-only event just land at
              the bottom of the editor, which is the correct behavior
              since the section legitimately doesn't exist for them. */}
          {!event.is_sdg_only && (
            <section id="contracts" style={{ scrollMarginTop: '96px' }}>
              <EventContractsPanel eventId={event.id} />
            </section>
          )}
          {/* Guest list allocation lives on its own page at
              /bananas/guest-list/<id> — reachable from the Events row's
              GUEST LIST button. Kept off the edit page so this screen stays
              focused on the event details / ticketing / contracts triad. */}
        </>
      )}
    />
  );
}

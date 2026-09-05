import { createClient } from '@/lib/supabase/server';
import EventsTabPanel from './EventsTabPanel';
import { getTodayInAustin } from '@/lib/studio-helpers';
import { loadEventsCalendarData } from '@/lib/events-calendar-data';
import { adminPageGate, OWNER_EMAIL } from '@/lib/auth-helpers';

export const revalidate = 0;

// The header, section sidebar and tile grid all live in the shell now
// (app/bananas/layout.js + AdminShell.js) so they persist while you navigate
// between admin pages. What is left here is the dashboard-only content: the
// events list, which now belongs to the Events section rather than trailing
// below every tile grid.
//
// The fetches stay here (server side) and EventsTabPanel decides whether the
// section showing is Events. It renders the Events Calendar above the list,
// which is why the calendar's dataset is loaded here too — through the same
// shared loader the standalone /team/calendar page uses, so the two surfaces
// can never drift apart.
//
// The admin gate runs in the layout, but we still call it here to read the
// viewer identity: EventsTabPanel needs `isOwner` to decide whether a
// `?tab=analytics` URL really is Analytics (owner) or falls back to Events
// (non-owner). Without this prop the panel used the resolver's default
// non-owner path and the events calendar bled through under owner-only
// sections. Cheap: the gate itself only reads the current session.
export default async function AdminDashboard() {
  const [supabase, { user }] = await Promise.all([
    createClient(),
    adminPageGate(),
  ]);

  const [{ data: events }, calendar] = await Promise.all([
    supabase.from('events').select('*').order('event_date', { ascending: true }),
    loadEventsCalendarData(supabase),
  ]);

  // The Events list now shows live ticket sales beside each row (where the
  // per-event ARTIST PAY button used to sit — that section moved to its own
  // MONEY sidebar tab). We read the cached per-event snapshot from
  // public.event_ticket_metrics rather than hitting TicketTailor here: the
  // cache is kept warm by the scheduled refresh (/api/admin/refresh-event-
  // metrics) and by the per-row refresh button in EventTicketSalesLive, so
  // the initial render is instant and always shows real numbers.
  //
  // Only events with a TT series can have real numbers, so scope the query
  // to those ids to keep it cheap; internal-only events skip it entirely and
  // render no sales block on the row.
  const ticketedEventIds = (events || [])
    .filter((e) => Boolean(e.tt_event_series_id))
    .map((e) => e.id);
  const { data: metricsRows } = ticketedEventIds.length
    ? await supabase
        .from('event_ticket_metrics')
        .select('event_id, tickets_sold, gross_cents, fees_cents, status, fetched_at, error_detail')
        .in('event_id', ticketedEventIds)
    : { data: [] };
  const metricsByEvent = Object.fromEntries(
    (metricsRows || []).map((row) => [row.event_id, row])
  );

  const today = getTodayInAustin();
  const isOwner = user?.email === OWNER_EMAIL;

  return (
    <EventsTabPanel
      upcoming={(events || []).filter((e) => e.event_date >= today)}
      past={(events || []).filter((e) => e.event_date < today).reverse()}
      calendar={calendar}
      isOwner={isOwner}
      metricsByEvent={metricsByEvent}
    />
  );
}

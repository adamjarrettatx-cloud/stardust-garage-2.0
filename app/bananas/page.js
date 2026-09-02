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

  const today = getTodayInAustin();
  const isOwner = user?.email === OWNER_EMAIL;

  return (
    <EventsTabPanel
      upcoming={(events || []).filter((e) => e.event_date >= today)}
      past={(events || []).filter((e) => e.event_date < today).reverse()}
      calendar={calendar}
      isOwner={isOwner}
    />
  );
}

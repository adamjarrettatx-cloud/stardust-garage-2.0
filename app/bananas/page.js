import { createClient } from '@/lib/supabase/server';
import EventsTabPanel from './EventsTabPanel';
import { getTodayInAustin } from '@/lib/studio-helpers';
import { loadEventsCalendarData } from '@/lib/events-calendar-data';

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
// The admin gate runs in the layout; no need to repeat it.
export default async function AdminDashboard() {
  const supabase = await createClient();

  const [{ data: events }, calendar] = await Promise.all([
    supabase.from('events').select('*').order('event_date', { ascending: true }),
    loadEventsCalendarData(supabase),
  ]);

  const today = getTodayInAustin();

  return (
    <EventsTabPanel
      upcoming={(events || []).filter((e) => e.event_date >= today)}
      past={(events || []).filter((e) => e.event_date < today).reverse()}
      calendar={calendar}
    />
  );
}

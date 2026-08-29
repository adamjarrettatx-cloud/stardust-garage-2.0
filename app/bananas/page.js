import { createClient } from '@/lib/supabase/server';
import EventsTabPanel from './EventsTabPanel';
import { getTodayInAustin } from '@/lib/studio-helpers';

export const revalidate = 0;

// The header, section sidebar and tile grid all live in the shell now
// (app/bananas/layout.js + AdminShell.js) so they persist while you navigate
// between admin pages. What is left here is the dashboard-only content: the
// events list, which now belongs to the Events section rather than trailing
// below every tile grid.
//
// The fetch stays here (server side, one query) and EventsTabPanel decides
// whether the section showing is Events.
//
// The admin gate runs in the layout; no need to repeat it.
export default async function AdminDashboard() {
  const supabase = await createClient();

  const { data: events } = await supabase
    .from('events')
    .select('*')
    .order('event_date', { ascending: true });

  const today = getTodayInAustin();

  return (
    <EventsTabPanel
      upcoming={(events || []).filter((e) => e.event_date >= today)}
      past={(events || []).filter((e) => e.event_date < today).reverse()}
    />
  );
}

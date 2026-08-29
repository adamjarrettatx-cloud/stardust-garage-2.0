import { createClient } from '@/lib/supabase/server';
import EventsSection from './components/EventsSection';
import { getTodayInAustin } from '@/lib/studio-helpers';

export const revalidate = 0;

// The header, section sidebar and tile grid all live in the shell now
// (app/bananas/layout.js + AdminShell.js) so they persist while you navigate
// between admin pages. What is left here is the dashboard-only content: the
// events list that sits below the tiles and should not follow you into a
// subpage.
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
    <>
      <h2
        className="text-[18px] font-bold tracking-[0.12em] mb-5 mt-14"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        EVENTS
      </h2>
      <EventsSection
        upcoming={(events || []).filter((e) => e.event_date >= today)}
        past={(events || []).filter((e) => e.event_date < today).reverse()}
      />
    </>
  );
}

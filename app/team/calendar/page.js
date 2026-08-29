import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { loadEventsCalendarData } from '@/lib/events-calendar-data';
import EventsCalendarClient from '@/app/components/EventsCalendarClient';

export const revalidate = 0;

// ---------------------------------------------------------------------------
// Events Calendar — standalone page
// ---------------------------------------------------------------------------
// The calendar's home is now the top of the Events section on the admin
// dashboard (app/bananas/EventsTabPanel.js), so an admin who lands here is
// sent there rather than shown a second copy of the same grid. This route
// stays because a non-admin team member has no admin dashboard to open: it is
// where login and the middleware fallback drop them, and where the "← TEAM"
// links in Team Chat and Tasks point back to.
//
// Role comes from the server-verified team_members table (never trusted from
// the client), and the query itself is identical for both roles — RLS on
// team_events already scopes what each may read.
export default async function EventsCalendarPage() {
  const supabase = await createClient();
  const data = await loadEventsCalendarData(supabase);

  if (!data) redirect('/login');
  if (data.isAdmin) redirect('/bananas?tab=events');

  return <EventsCalendarClient variant="page" {...data} />;
}

import { redirect } from 'next/navigation';
import { requirePartner } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { profileCapabilities } from '@/lib/profile-capabilities';
import ProgrammingCalendar from './ProgrammingCalendar';
import '../programmer.css';

export const revalidate = 0;

// Programmer calendar. partner_programming_calendar() is the privacy boundary:
// it names only events already public on sdgatx.com/events and reports every
// other occupied date as Unavailable.
export default async function ProgrammerCalendarPage() {
  const { unauthorized, partner } = await requirePartner();
  if (unauthorized) redirect('/portal/login');
  if (!profileCapabilities(partner.contact_type).calendar) redirect('/account/profile');

  const supabase = await createClient();
  const [calendar, pitches] = await Promise.all([
    supabase.rpc('partner_programming_calendar'),
    supabase.rpc('partner_my_pitches'),
  ]);
  if (calendar.error) console.error('[programmer calendar]', calendar.error.message);

  return (
    <main className="pg">
      <div className="pg-shell">
        <div className="pg-intro">
          <p className="pg-eyebrow">PROGRAMMING CALENDAR</p>
          <h1>Find an open date.</h1>
          <p>Green dates are open. Choose one to pitch an event. Public shows are listed so you can plan around them.</p>
        </div>
        <ProgrammingCalendar days={calendar.data || []} pitches={pitches.data || []} />
      </div>
    </main>
  );
}

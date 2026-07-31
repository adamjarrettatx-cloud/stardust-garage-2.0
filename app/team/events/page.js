import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireTeam } from '@/lib/auth-helpers';
import { getTodayInAustin } from '@/lib/studio-helpers';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import TeamEventsSection from './TeamEventsSection';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Read-only Events list for Team members. The full admin Events section on
// /bananas (create/edit/delete) stays admin-only — this route exposes the
// same event data for viewing, nothing else. "Team can view all events" RLS
// (20260727_rls_security_hardening.sql) is the actual security boundary;
// requireTeam() below is defense-in-depth so an unauthenticated or
// unaffiliated caller never even reaches the query.
export default async function TeamEventsPage() {
  const { unauthorized } = await requireTeam();
  if (unauthorized) redirect('/login');

  const supabase = await createClient();

  const { data: events } = await supabase
    .from('events')
    .select('id, title, event_date, event_time, slug, status, visibility, image_url')
    .order('event_date', { ascending: true });

  const today = getTodayInAustin();

  return (
    <main className="max-w-[900px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        backHref="/team/calendar"
        backLabel="← TEAM CALENDAR"
        title="Events"
        description="Everything on the books — view only."
        titleClassName="text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      />

      <TeamEventsSection
        upcoming={(events || []).filter((e) => e.event_date >= today)}
        past={(events || []).filter((e) => e.event_date < today).reverse()}
      />
    </main>
  );
}

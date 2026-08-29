import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import MemberDetailClient from './MemberDetailClient';

export const revalidate = 0;

// Admin-gated member profile. Before this page existed, clicking a row on
// /bananas/members did nothing — the row was a plain <div> with no destination,
// which is why nothing happened on click.
//
// Everything shown here is read-only history assembled from the tables that
// already reference member_profiles. The only mutating control is the existing
// cancel-subscription action.
export default async function MemberDetailPage({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { id } = await params;
  const supabase = await createClient();

  const { data: member, error } = await supabase
    .from('member_profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !member) notFound();

  const email = (member.email || '').toLowerCase();

  // The application is normally linked by application_id. Members who were
  // created before that column was populated (or activated manually) fall back
  // to an email match so their answers still show up.
  const applicationQuery = member.application_id
    ? supabase.from('membership_applications').select('*').eq('id', member.application_id).maybeSingle()
    : email
      ? supabase
          .from('membership_applications')
          .select('*')
          .ilike('email', email)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null });

  // member_tickets.member_id is a best-effort match written at webhook time, so
  // tickets bought before the profile existed only carry buyer_email. Query on
  // both and de-duplicate by ticket id.
  const [application, ticketsById, ticketsByEmail, bookings, trialPass] = await Promise.all([
    applicationQuery,
    supabase
      .from('member_tickets')
      .select('id, description, status, checked_in, order_status, created_at, local_event_id, tt_event_id')
      .eq('member_id', id)
      .order('created_at', { ascending: false })
      .limit(100),
    email
      ? supabase
          .from('member_tickets')
          .select('id, description, status, checked_in, order_status, created_at, local_event_id, tt_event_id')
          .ilike('buyer_email', email)
          .order('created_at', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: [] }),
    supabase
      .from('studio_bookings')
      .select('id, booking_date, start_hour, end_hour, total_cost_cents, status, notes, created_at, cancelled_at')
      .eq('member_id', id)
      .order('booking_date', { ascending: false })
      .limit(100),
    supabase
      .from('trial_passes')
      .select('id, status, issued_at, expires_at, extended_until, converted_at, source, created_at')
      .eq('member_profile_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const ticketMap = new Map();
  for (const t of [...(ticketsById.data || []), ...(ticketsByEmail.data || [])]) {
    ticketMap.set(t.id, t);
  }
  const tickets = [...ticketMap.values()].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );

  // One extra round trip to name the events those tickets belong to, skipped
  // entirely when the member has no locally-linked tickets.
  const eventIds = [...new Set(tickets.map((t) => t.local_event_id).filter(Boolean))];
  let eventsById = {};
  if (eventIds.length > 0) {
    const { data: events } = await supabase
      .from('events')
      .select('id, title, event_date, slug')
      .in('id', eventIds);
    eventsById = Object.fromEntries((events || []).map((e) => [e.id, e]));
  }

  return (
    <div className="max-w-[900px]">
      <MemberDetailClient
        member={member}
        application={application?.data || null}
        tickets={tickets}
        eventsById={eventsById}
        bookings={bookings.data || []}
        trialPass={trialPass?.data || null}
      />
    </div>
  );
}

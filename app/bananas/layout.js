import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate, OWNER_EMAIL } from '@/lib/auth-helpers';
import { getTodayInAustin } from '@/lib/studio-helpers';
import { totalUnreadCount } from '@/lib/chat';
import LogoutButton from './components/LogoutButton';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import AdminShell from './AdminShell';

export const revalidate = 0;

// ---------------------------------------------------------------------------
// Admin shell layout
// ---------------------------------------------------------------------------
// The header and section sidebar live here rather than on the dashboard page so
// they persist across navigation. Opening Contacts from the People section now
// swaps only the right-hand panel; the sidebar stays put and a breadcrumb links
// back to the section, instead of the destination taking over the whole screen
// as its own page you had to back out of.
//
// The counts behind the sidebar badges are fetched once here, so they no longer
// need re-fetching per page and stay accurate on every admin route rather than
// only on the dashboard.
//
// Note on gating: this gate is the floor (any admin), not the ceiling. Pages
// with stricter requirements still run their own ownerPageGate() / requireTeam()
// — a layout in Next.js does not re-run on client-side navigation between child
// routes, so it must never be the only thing standing between a user and
// owner-only data.
export default async function BananasLayout({ children }) {
  const { user, redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();
  const today = getTodayInAustin();

  const [
    applicationsCount,
    venueInquiriesCount,
    microPartiesCount,
    collaborationsCount,
    newSignupsCount,
    upcomingBookingsCount,
    activeMembersCount,
    pastDueMembersCount,
    unreadChat,
    pendingPayRequestsCount,
  ] = await Promise.all([
    supabase.from('membership_applications').select('*', { count: 'exact', head: true }).or('status.eq.new,status.is.null'),
    supabase.from('venue_inquiries').select('*', { count: 'exact', head: true }).or('status.eq.new,status.is.null'),
    supabase.from('micro_party_inquiries').select('*', { count: 'exact', head: true }).or('status.eq.new,status.is.null'),
    supabase.from('collaborations').select('*', { count: 'exact', head: true }).or('status.eq.new,status.is.null'),
    supabase.from('signups').select('*', { count: 'exact', head: true }).or('status.eq.new,status.is.null'),
    supabase.from('studio_bookings').select('*', { count: 'exact', head: true }).eq('status', 'confirmed').gte('booking_date', today),
    supabase.from('member_profiles').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('member_profiles').select('*', { count: 'exact', head: true }).eq('subscription_status', 'past_due'),
    // Unread Team Chat messages for whoever is signed in. Scoped to the caller
    // by the RPC itself — it takes no arguments.
    supabase.rpc('chat_unread_counts'),
    // artist_pay_requests doesn't exist on live Supabase until the Phase 3
    // migration is applied — this errors harmlessly until then (count comes
    // back undefined, || 0 below covers it).
    supabase.from('artist_pay_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending_review'),
  ]);

  const isOwner = user?.email === OWNER_EMAIL;

  const counts = {
    applications: applicationsCount?.count || 0,
    venueInquiries: venueInquiriesCount?.count || 0,
    microParties: microPartiesCount?.count || 0,
    collaborations: collaborationsCount?.count || 0,
    newSignups: newSignupsCount?.count || 0,
    upcomingBookings: upcomingBookingsCount?.count || 0,
    activeMembers: activeMembersCount?.count || 0,
    pastDueMembers: pastDueMembersCount?.count || 0,
    unreadChat: totalUnreadCount(unreadChat?.data),
    pendingPayRequests: pendingPayRequestsCount?.count || 0,
  };

  return (
    <main className="max-w-[1320px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        title="Admin"
        description={`Signed in as ${user?.email}`}
        titleClassName="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      >
        <LogoutButton />
      </AuthenticatedPageHeader>

      <AdminShell isOwner={isOwner} counts={counts}>
        {children}
      </AdminShell>
    </main>
  );
}

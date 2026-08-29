import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import LogoutButton from './components/LogoutButton';
import EventsSection from './components/EventsSection';
import AdminDashboardClient from './AdminDashboardClient';
import { getTodayInAustin } from '@/lib/studio-helpers';
import { totalUnreadCount } from '@/lib/chat';
import { resolveAdminTab } from '@/lib/admin-tabs';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;

// The owner email that gets full access to all tabs.
const OWNER_EMAIL = 'adam@sdgatx.com';

export default async function AdminDashboard({ searchParams }) {
  const { user, redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  // Next 15 hands searchParams over as a promise.
  const params = (await searchParams) || {};

  const supabase = await createClient();

  const { data: events } = await supabase
    .from('events')
    .select('*')
    .order('event_date', { ascending: true });

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
    // back undefined, || 0 below covers it), same as event_bookings did
    // during the Phase 2 window.
    supabase.from('artist_pay_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending_review'),
  ]);

  const isOwner = user?.email === OWNER_EMAIL;

  // Resolve the section from the URL on the server so a deep link such as
  // /bananas?tab=people renders People on first paint instead of flashing the
  // default Team tab. resolveAdminTab also falls back to the default for an
  // unknown tab id, or an owner-only tab requested by a non-owner.
  const initialTab = resolveAdminTab(params.tab, { isOwner });

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
    <main className="max-w-[1200px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        title="Admin"
        description={`Signed in as ${user?.email}`}
        titleClassName="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      >
        <LogoutButton />
      </AuthenticatedPageHeader>

      <AdminDashboardClient isOwner={isOwner} counts={counts} initialTab={initialTab} />

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
    </main>
  );
}

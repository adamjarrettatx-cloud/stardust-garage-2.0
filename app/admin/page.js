import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import LogoutButton from './components/LogoutButton';
import EventsSection from './components/EventsSection';
import AdminDashboardClient from './AdminDashboardClient';
import { getTodayInAustin } from '@/lib/studio-helpers';

export const revalidate = 0;

// The owner email that gets full access to all tabs.
const OWNER_EMAIL = 'adam@sdgatx.com';

export default async function AdminDashboard() {
  const { user, redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

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
    recentSignupsCount,
    upcomingBookingsCount,
    activeMembersCount,
    pastDueMembersCount,
  ] = await Promise.all([
    supabase.from('membership_applications').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('venue_inquiries').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('micro_party_inquiries').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('collaborations').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('signups').select('*', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    supabase.from('studio_bookings').select('*', { count: 'exact', head: true }).eq('status', 'confirmed').gte('booking_date', today),
    supabase.from('member_profiles').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('member_profiles').select('*', { count: 'exact', head: true }).eq('subscription_status', 'past_due'),
  ]);

  const isOwner = user?.email === OWNER_EMAIL;

  const counts = {
    applications: applicationsCount?.count || 0,
    venueInquiries: venueInquiriesCount?.count || 0,
    microParties: microPartiesCount?.count || 0,
    collaborations: collaborationsCount?.count || 0,
    recentSignups: recentSignupsCount?.count || 0,
    upcomingBookings: upcomingBookingsCount?.count || 0,
    activeMembers: activeMembersCount?.count || 0,
    pastDueMembers: pastDueMembersCount?.count || 0,
  };

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-16">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1
            className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Admin
          </h1>
          <p className="text-[14px] mt-2" style={{ color: '#8a8a8a' }}>
            Signed in as {user?.email}
          </p>
        </div>
        <LogoutButton />
      </div>

      <AdminDashboardClient isOwner={isOwner} counts={counts} />

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

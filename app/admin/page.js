import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import LogoutButton from './components/LogoutButton';
import EventsSection from './components/EventsSection';
import { getTodayInAustin } from '@/lib/studio-helpers';

export const revalidate = 0;

function Tile({ href, eyebrow, title, count = 0 }) {
  const isHighlighted = count > 0;
  return (
    <Link
      href={href}
      className="relative rounded-[14px] p-5 border transition-colors hover:border-white/20"
      style={{
        background: isHighlighted ? '#1f1c14' : '#141414',
        borderColor: isHighlighted ? 'rgba(255,200,80,0.25)' : 'rgba(255,255,255,0.05)',
      }}
    >
      <div className="text-[10px] font-semibold tracking-[0.14em] mb-1.5" style={{ color: '#8a8a8a' }}>{eyebrow}</div>
      <div className="text-[15px] font-bold" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{title}</div>
      {count > 0 && (
        <span
          className="absolute top-3 right-3 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-bold leading-none"
          style={{ background: '#ffb84d', color: '#0a0a0a', fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          aria-label={`${count} new`}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

export default async function AdminDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

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

  return (
    <main className="max-w-[1200px] mx-auto px-6 py-16">
      <div className="flex items-center justify-between mb-12">
        <div>
          <h1 className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Admin</h1>
          <p className="text-[14px] mt-2" style={{ color: '#8a8a8a' }}>Signed in as {user?.email}</p>
        </div>
        <LogoutButton />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4 mb-14">
        <Tile href="/admin/applications" eyebrow="REVIEW" title="Applications" count={applicationsCount?.count || 0} />
        <Tile href="/admin/members" eyebrow="MANAGE" title="Members" count={pastDueMembersCount?.count || 0} />
        <Tile href="/admin/venue-inquiries" eyebrow="REVIEW" title="Venue Inquiries" count={venueInquiriesCount?.count || 0} />
        <Tile href="/admin/micro-parties" eyebrow="REVIEW" title="Micro Parties" count={microPartiesCount?.count || 0} />
        <Tile href="/admin/collaborations" eyebrow="REVIEW" title="Collaborations" count={collaborationsCount?.count || 0} />
        <Tile href="/admin/signups" eyebrow="VIEW" title="Signups" count={recentSignupsCount?.count || 0} />
        <Tile href="/admin/studio-bookings" eyebrow="MANAGE" title="Studio Bookings" count={upcomingBookingsCount?.count || 0} />
        <Tile href="/admin/studio-settings" eyebrow="MANAGE" title="Studio Settings" />
        <Tile href="/admin/settings" eyebrow="MANAGE" title="Settings" />
        <Tile href="/admin/calendar" eyebrow="TEAM ONLY" title="Team Calendar" />
        <Tile href="/admin/team" eyebrow="MANAGE" title="Team Members" />
        <Tile href="/admin/documents" eyebrow="PRIVATE" title="Documents" />
        <Tile href="/admin/analytics" eyebrow="INSIGHTS" title="Event Analytics" />
        <Tile href="/admin/security" eyebrow="ACCOUNT" title="Security / MFA" />
      </div>

      <h2 className="text-[18px] font-bold tracking-[0.12em] mb-5" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>EVENTS</h2>
      <EventsSection
        upcoming={(events || []).filter(e => e.event_date >= today)}
        past={(events || []).filter(e => e.event_date < today).reverse()}
      />
    </main>
  );
}

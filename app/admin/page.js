import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import LogoutButton from './components/LogoutButton';
import DeleteEventButton from './components/DeleteEventButton';
import { getTodayInAustin } from '@/lib/studio-helpers';

export const revalidate = 0;

function formatDate(dateString) {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

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
        <Tile href="/admin" eyebrow="CURRENT" title="Events" />
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
      </div>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-[18px] font-bold tracking-[0.12em]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>EVENTS</h2>
        <Link href="/admin/events/new" className="px-6 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5" style={{ background: '#ffffff', color: '#0a0a0a' }}>+ NEW EVENT</Link>
      </div>

      {!events || events.length === 0 ? (
        <div className="rounded-[14px] p-12 text-center border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
          <p style={{ color: '#8a8a8a' }}>No events yet. Click &quot;+ NEW EVENT&quot; to create one.</p>
        </div>
      ) : (() => {
        const upcoming = events.filter(e => e.event_date >= today);
        const past = events.filter(e => e.event_date < today).reverse();

        const EventRow = (event) => (
          <div key={event.id} className="rounded-[14px] border p-5 flex items-center gap-5" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
            <div className="w-20 h-20 rounded-[10px] overflow-hidden flex-shrink-0 bg-[#1a1a1a]">
              {event.image_url && <img src={event.image_url} alt={event.title} className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] mb-1" style={{ color: '#8a8a8a' }}>{formatDate(event.event_date)}{event.event_time ? ` · ${event.event_time}` : ''}</div>
              <h3 className="text-[17px] font-bold truncate" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>{event.title}</h3>
              <div className="text-[12px] mt-1" style={{ color: '#555' }}>/events/{event.slug}</div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Link href={`/admin/events/${event.id}`} className="px-4 py-2 rounded-full text-[11px] font-semibold tracking-[0.12em] border transition-colors hover:bg-white/5" style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#f5f5f5' }}>EDIT</Link>
              <DeleteEventButton eventId={event.id} eventTitle={event.title} />
            </div>
          </div>
        );

        return (
          <div className="space-y-10">
            {/* Upcoming */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[11px] font-semibold tracking-[0.16em]" style={{ color: '#ffb84d' }}>UPCOMING</span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,184,77,0.15)', color: '#ffb84d' }}>{upcoming.length}</span>
              </div>
              {upcoming.length === 0 ? (
                <div className="rounded-[14px] p-6 text-center border" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.05)' }}>
                  <p className="text-[13px]" style={{ color: '#555' }}>No upcoming events.</p>
                </div>
              ) : (
                <div className="space-y-3">{upcoming.map(EventRow)}</div>
              )}
            </div>

            {/* Past */}
            {past.length > 0 && (
              <div>
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-[11px] font-semibold tracking-[0.16em]" style={{ color: '#8a8a8a' }}>PAST</span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)', color: '#8a8a8a' }}>{past.length}</span>
                </div>
                <div className="space-y-3 opacity-60">{past.map(EventRow)}</div>
              </div>
            )}
          </div>
        );
      })()}
    </main>
  );
}

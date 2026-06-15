import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import {
  formatHour,
  formatMoney,
  formatDateDisplay,
  getTodayInAustin,
} from '@/lib/studio-helpers';
import AdminBookingActions from './AdminBookingActions';

export const revalidate = 0;

export default async function AdminStudioBookingsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();

  // Pull all bookings, joined with member info
  const { data: bookings } = await supabase
    .from('studio_bookings')
    .select('*')
    .order('booking_date', { ascending: false });

  // Also pull member profiles for display
  const memberIds = [...new Set((bookings || []).map((b) => b.member_id))];
  const { data: profiles } = memberIds.length
    ? await supabase
        .from('member_profiles')
        .select('user_id, full_name, email')
        .in('user_id', memberIds)
    : { data: [] };

  const profileMap = Object.fromEntries(
    (profiles || []).map((p) => [p.user_id, p])
  );

  const today = getTodayInAustin();
  const upcoming = (bookings || []).filter(
    (b) => b.booking_date >= today && b.status === 'confirmed'
  );
  const past = (bookings || []).filter(
    (b) => b.booking_date < today || b.status === 'cancelled'
  );

  return (
    <main className="max-w-[1100px] mx-auto px-6 py-16">
      <Link
        href="/admin"
        className="text-[12px] tracking-[0.14em] mb-4 inline-block hover:text-white transition-colors"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO ADMIN
      </Link>
      <h1
        className="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-10"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Studio Bookings
      </h1>

      {/* Upcoming */}
      <div className="mb-12">
        <div
          className="text-[11px] font-semibold tracking-[0.18em] mb-4"
          style={{ color: '#8a8a8a' }}
        >
          UPCOMING ({upcoming.length})
        </div>
        {upcoming.length === 0 ? (
          <div
            className="rounded-[14px] border p-8 text-center"
            style={{
              background: '#141414',
              borderColor: 'rgba(255,255,255,0.06)',
            }}
          >
            <p style={{ color: '#8a8a8a' }}>No upcoming bookings.</p>
          </div>
        ) : (
          upcoming.map((b) => (
            <BookingRow
              key={b.id}
              booking={b}
              profile={profileMap[b.member_id]}
            />
          ))
        )}
      </div>

      {/* Past */}
      {past.length > 0 && (
        <div>
          <div
            className="text-[11px] font-semibold tracking-[0.18em] mb-4"
            style={{ color: '#8a8a8a' }}
          >
            PAST & CANCELLED ({past.length})
          </div>
          {past.map((b) => (
            <BookingRow
              key={b.id}
              booking={b}
              profile={profileMap[b.member_id]}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function BookingRow({ booking, profile }) {
  const isCancelled = booking.status === 'cancelled';
  return (
    <div
      className="rounded-[14px] border p-5 mb-3 flex items-center gap-5"
      style={{
        background: '#141414',
        borderColor: 'rgba(255,255,255,0.06)',
        opacity: isCancelled ? 0.5 : 1,
      }}
    >
      <div className="flex-1 min-w-0">
        <div
          className="text-[15px] font-bold mb-1"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          {profile?.full_name || profile?.email || 'Unknown member'}
        </div>
        <div className="text-[13px]" style={{ color: '#a0a0a0' }}>
          {formatDateDisplay(booking.booking_date)} ·{' '}
          {formatHour(booking.start_hour)} – {formatHour(booking.end_hour)}
        </div>
        <div className="text-[12px] mt-1" style={{ color: '#555' }}>
          {formatMoney(booking.total_cost_cents)}
          {profile?.email ? ` · ${profile.email}` : ''}
        </div>
        {booking.notes && (
          <div className="text-[12px] mt-2 italic" style={{ color: '#8a8a8a' }}>
            &ldquo;{booking.notes}&rdquo;
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        <div
          className="text-[10px] font-semibold tracking-[0.14em] px-2.5 py-1 rounded-full"
          style={{
            background: isCancelled
              ? 'rgba(255,80,80,0.15)'
              : 'rgba(80,200,120,0.15)',
            color: isCancelled ? '#ff8080' : '#80c878',
          }}
        >
          {isCancelled ? 'CANCELLED' : 'CONFIRMED'}
        </div>
        {!isCancelled && (
          <AdminBookingActions bookingId={booking.id} />
        )}
      </div>
    </div>
  );
}

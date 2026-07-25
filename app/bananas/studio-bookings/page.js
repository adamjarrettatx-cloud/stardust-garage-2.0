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
import {
  AuthenticatedPageHeader,
  AuthenticatedPageSurface,
} from '@/app/components/AuthenticatedPageTheme';

export const revalidate = 0;

export default async function AdminStudioBookingsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const supabase = await createClient();

  const { data: bookings } = await supabase
    .from('studio_bookings')
    .select('*')
    .order('booking_date', { ascending: false });

  const memberIds = [...new Set((bookings || []).map((b) => b.member_id))];
  const { data: profiles } = memberIds.length
    ? await supabase
        .from('member_profiles')
        .select('user_id, full_name, email')
        .in('user_id', memberIds)
    : { data: [] };

  const profileMap = Object.fromEntries(
    (profiles || []).map((p) => [p.user_id, p]),
  );

  const today = getTodayInAustin();
  const upcoming = (bookings || []).filter(
    (booking) => booking.booking_date >= today && booking.status === 'confirmed',
  );
  const past = (bookings || []).filter(
    (booking) => booking.booking_date < today || booking.status === 'cancelled',
  );

  return (
    <AuthenticatedPageSurface
      scope="admin"
      width="max-w-[1100px]"
      className="transition-colors duration-150"
      testId="route-bananas-studio-bookings"
    >
      <AuthenticatedPageHeader
        scope="admin"
        backHref="/bananas"
        title="Studio Bookings"
      />

      <div className="mb-12">
        <div className="text-[11px] font-semibold tracking-[0.18em] mb-4" style={{ color: 'var(--auth-muted)' }}>
          UPCOMING ({upcoming.length})
        </div>
        {upcoming.length === 0 ? (
          <div
            className="rounded-[14px] border p-8 text-center"
            style={{ background: 'var(--auth-card-bg)', borderColor: 'var(--auth-card-border)' }}
          >
            <p style={{ color: 'var(--auth-muted)' }}>No upcoming bookings.</p>
          </div>
        ) : (
          upcoming.map((booking) => (
            <BookingRow
              key={booking.id}
              booking={booking}
              profile={profileMap[booking.member_id]}
            />
          ))
        )}
      </div>

      {past.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold tracking-[0.18em] mb-4" style={{ color: 'var(--auth-muted)' }}>
            PAST & CANCELLED ({past.length})
          </div>
          {past.map((booking) => (
            <BookingRow
              key={booking.id}
              booking={booking}
              profile={profileMap[booking.member_id]}
            />
          ))}
        </div>
      )}
    </AuthenticatedPageSurface>
  );
}

function BookingRow({ booking, profile }) {
  const isCancelled = booking.status === 'cancelled';

  return (
    <div
      className="rounded-[14px] border p-5 mb-3 flex items-center gap-5"
      style={{
        background: 'var(--auth-card-bg)',
        borderColor: 'var(--auth-card-border)',
        opacity: isCancelled ? 0.5 : 1,
      }}
    >
      <div className="flex-1 min-w-0">
        <div
          className="text-[15px] font-bold mb-1"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: 'var(--auth-text-strong)' }}
        >
          {profile?.full_name || profile?.email || 'Unknown member'}
        </div>
        <div className="text-[13px]" style={{ color: 'var(--auth-muted-strong)' }}>
          {formatDateDisplay(booking.booking_date)} · {formatHour(booking.start_hour)} – {formatHour(booking.end_hour)}
        </div>
        <div className="text-[12px] mt-1" style={{ color: 'var(--auth-faint)' }}>
          {formatMoney(booking.total_cost_cents)}
          {profile?.email ? ` · ${profile.email}` : ''}
        </div>
        {booking.notes ? (
          <div className="text-[12px] mt-2 italic" style={{ color: 'var(--auth-muted)' }}>
            &ldquo;{booking.notes}&rdquo;
          </div>
        ) : null}
      </div>

      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        <div
          className="text-[10px] font-semibold tracking-[0.14em] px-2.5 py-1 rounded-full"
          style={{
            background: isCancelled ? 'rgba(255,80,80,0.15)' : 'rgba(80,200,120,0.15)',
            color: isCancelled ? '#ff8080' : '#80c878',
          }}
        >
          {isCancelled ? 'CANCELLED' : 'CONFIRMED'}
        </div>
        {!isCancelled ? <AdminBookingActions bookingId={booking.id} /> : null}
      </div>
    </div>
  );
}

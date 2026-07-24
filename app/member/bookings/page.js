import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { getTodayInAustin } from '@/lib/studio-helpers';
import BookingsList from './BookingsList';

export const revalidate = 0;

export default async function MyBookingsPage() {
  const { user } = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();

  // Get settings for the min_advance_hours value (so client can decide what's cancellable)
  const { data: settings } = await supabase
    .from('studio_settings')
    .select('min_advance_hours')
    .eq('id', 1)
    .single();

  // Load this member's bookings - all of them
  const { data: bookings } = await supabase
    .from('studio_bookings')
    .select('*')
    .eq('member_id', user.id)
    .order('booking_date', { ascending: false });

  const today = getTodayInAustin();
  const upcoming = (bookings || []).filter(
    (b) => b.booking_date >= today && b.status === 'confirmed'
  );
  const past = (bookings || []).filter(
    (b) => b.booking_date < today || b.status === 'cancelled'
  );

  return (
    <main className="max-w-[900px] mx-auto px-6 py-16">
      <div className="mb-10">
        <Link
          href="/member"
          className="text-[12px] tracking-[0.14em] mb-4 inline-block hover:text-white transition-colors"
          style={{ color: 'var(--text-3)' }}
        >
          ← BACK TO MEMBER HOME
        </Link>
        <div
          className="text-[11px] font-semibold tracking-[0.28em] mb-3"
          style={{ color: 'var(--fg-a5)' }}
        >
          MEMBER AREA
        </div>
        <h1
          className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          My Bookings.
        </h1>
      </div>

      <BookingsList
        upcoming={upcoming}
        past={past}
        minAdvanceHours={settings?.min_advance_hours || 24}
      />
    </main>
  );
}

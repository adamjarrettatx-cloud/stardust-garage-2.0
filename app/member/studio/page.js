import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { getTodayInAustin } from '@/lib/studio-helpers';
import StudioBookingClient from './StudioBookingClient';

export const revalidate = 0;

export default async function StudioPage() {
  const { user } = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();

  // Verify active member
  const { data: profile } = await supabase
    .from('member_profiles')
    .select('is_active, full_name')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    return (
      <main className="max-w-[900px] mx-auto px-6 py-16">
        <h1
          className="text-[28px] font-extrabold -tracking-[0.02em] mb-4"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Membership inactive
        </h1>
        <p style={{ color: 'var(--text-3)' }}>
          Your membership isn&apos;t active right now. Contact us at hello@sdgatx.com.
        </p>
      </main>
    );
  }

  // Load settings
  const { data: settings } = await supabase
    .from('studio_settings')
    .select('*')
    .eq('id', 1)
    .single();

  // Load upcoming confirmed bookings (next 60 days) so client knows what's blocked
  const today = getTodayInAustin();
  const sixtyDaysOut = new Date(today + 'T00:00:00');
  sixtyDaysOut.setDate(sixtyDaysOut.getDate() + 60);
  const horizonDate = sixtyDaysOut.toISOString().split('T')[0];

  const { data: bookings } = await supabase
    .from('studio_bookings')
    .select('booking_date, start_hour, end_hour')
    .eq('status', 'confirmed')
    .gte('booking_date', today)
    .lte('booking_date', horizonDate);

  return (
    <StudioBookingClient
      settings={settings}
      existingBookings={bookings || []}
    />
  );
}

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { getTodayInAustin } from '@/lib/studio-helpers';
import StudioBookingClient from './StudioBookingClient';
import { canBookStudio } from '@/lib/profile-capabilities';

export const revalidate = 0;

export default async function StudioPage() {
  const { user } = await getCurrentUser();
  if (!user) redirect('/login');

  const supabase = await createClient();

  // Verify active member
  const { data: profile } = await supabase
    .from('member_profiles')
    .select('is_active, full_name, subscription_plan, subscription_status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!canBookStudio(profile)) redirect('/member');

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

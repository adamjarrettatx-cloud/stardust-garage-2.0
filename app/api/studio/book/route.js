import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import {
  getNowInAustin,
  hoursBetween,
  dayOfWeek,
} from '@/lib/studio-helpers';

// POST /api/studio/book
// Body: { booking_date: 'YYYY-MM-DD', start_hour: number, end_hour: number, notes?: string }
//
// Server-side validation enforces:
//   - User is authenticated and is an active member
//   - Date is in the future
//   - Date is within open_days
//   - Hours are within open_hour..close_hour
//   - end > start
//   - Length >= min_booking_hours
//   - Booking starts at least min_advance_hours from now
//   - No overlap with existing confirmed bookings
export async function POST(request) {
  try {
    const serverClient = await createServerClient();
    const { data: { user } } = await serverClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { booking_date, start_hour, end_hour, notes } = await request.json();

    if (!booking_date || start_hour === undefined || end_hour === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Use service role for the sensitive reads/writes
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Make sure the user has an active member_profile
    const { data: profile } = await supabaseAdmin
      .from('member_profiles')
      .select('is_active')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile || !profile.is_active) {
      return NextResponse.json(
        { error: 'Active membership required to book studio time' },
        { status: 403 }
      );
    }

    // Load settings
    const { data: settings } = await supabaseAdmin
      .from('studio_settings')
      .select('*')
      .eq('id', 1)
      .single();

    if (!settings) {
      return NextResponse.json({ error: 'Studio settings not configured' }, { status: 500 });
    }

    // Validate the booking against settings
    if (end_hour <= start_hour) {
      return NextResponse.json({ error: 'End hour must be after start hour' }, { status: 400 });
    }
    if (start_hour < settings.open_hour || end_hour > settings.close_hour) {
      return NextResponse.json(
        { error: `Bookings must be between ${settings.open_hour}:00 and ${settings.close_hour}:00` },
        { status: 400 }
      );
    }
    const length = end_hour - start_hour;
    if (length < settings.min_booking_hours) {
      return NextResponse.json(
        { error: `Minimum booking length is ${settings.min_booking_hours} hours` },
        { status: 400 }
      );
    }

    // Day-of-week check
    const dow = dayOfWeek(booking_date);
    if (!settings.open_days.includes(dow)) {
      return NextResponse.json(
        { error: 'Studio is not bookable on this day of the week' },
        { status: 400 }
      );
    }

    // Advance time check
    const now = getNowInAustin();
    const hoursFromNow = hoursBetween(
      now.date,
      now.hour + now.minute / 60,
      booking_date,
      start_hour
    );
    if (hoursFromNow < settings.min_advance_hours) {
      return NextResponse.json(
        { error: `Bookings must start at least ${settings.min_advance_hours} hours in advance` },
        { status: 400 }
      );
    }

    // Overlap check - load existing confirmed bookings for this date
    const { data: existing } = await supabaseAdmin
      .from('studio_bookings')
      .select('start_hour, end_hour')
      .eq('booking_date', booking_date)
      .eq('status', 'confirmed');

    if (existing && existing.length > 0) {
      for (const b of existing) {
        // Overlap if not (newEnd <= existingStart || newStart >= existingEnd)
        const overlaps = !(end_hour <= b.start_hour || start_hour >= b.end_hour);
        if (overlaps) {
          return NextResponse.json(
            { error: 'Those hours overlap with an existing booking. Please pick different times.' },
            { status: 409 }
          );
        }
      }
    }

    // All validated — create the booking
    const totalCostCents = length * settings.hourly_rate_cents;

    const { data: booking, error: insertError } = await supabaseAdmin
      .from('studio_bookings')
      .insert({
        member_id: user.id,
        booking_date,
        start_hour,
        end_hour,
        total_cost_cents: totalCostCents,
        status: 'confirmed', // Phase D will change this to 'pending_payment' until Stripe confirms
        notes: notes?.trim() || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Booking insert failed:', insertError);
      return NextResponse.json(
        { error: 'Failed to create booking: ' + insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, booking });
  } catch (err) {
    console.error('Studio book route error:', err);
    return NextResponse.json(
      { error: 'Server error: ' + (err?.message || 'unknown') },
      { status: 500 }
    );
  }
}

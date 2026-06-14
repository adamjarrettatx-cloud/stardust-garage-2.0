import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentUser } from '@/lib/auth-helpers';
import { getNowInAustin, hoursBetween } from '@/lib/studio-helpers';

// POST /api/studio/cancel
// Body: { booking_id: uuid }
//
// Members can cancel their own bookings if they're >24hr away from start.
// Admins can cancel any booking at any time.
export async function POST(request) {
  try {
    const { user, isAdmin } = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { booking_id } = await request.json();
    if (!booking_id) {
      return NextResponse.json({ error: 'Missing booking_id' }, { status: 400 });
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Load the booking
    const { data: booking, error: fetchError } = await supabaseAdmin
      .from('studio_bookings')
      .select('*')
      .eq('id', booking_id)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }

    if (booking.status === 'cancelled') {
      return NextResponse.json({ error: 'Booking is already cancelled' }, { status: 400 });
    }

    const isOwner = booking.member_id === user.id;

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Not allowed to cancel this booking' }, { status: 403 });
    }

    // Members must cancel >24hr in advance. Admins bypass this rule.
    if (!isAdmin) {
      const { data: settings } = await supabaseAdmin
        .from('studio_settings')
        .select('min_advance_hours')
        .eq('id', 1)
        .single();
      const minAdvance = settings?.min_advance_hours || 24;

      const now = getNowInAustin();
      const hoursAway = hoursBetween(
        now.date,
        now.hour + now.minute / 60,
        booking.booking_date,
        booking.start_hour
      );

      if (hoursAway < minAdvance) {
        return NextResponse.json(
          {
            error: `Bookings can only be cancelled at least ${minAdvance} hours before the start time. Contact us at hello@sdgatx.com if you need help.`,
          },
          { status: 400 }
        );
      }
    }

    // Cancel
    const { error: updateError } = await supabaseAdmin
      .from('studio_bookings')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', booking_id);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to cancel: ' + updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Cancel route error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

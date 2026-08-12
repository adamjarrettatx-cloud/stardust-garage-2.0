import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildBookingPayload, bookingPayInProgress, loadEventBookings, auditBooking } from '@/lib/booking-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// Loads the booking and confirms it belongs to the event in the URL, so a
// booking id from another event can't be edited through this path — same
// guard as the guestlist grant routes.
async function loadBooking(admin, eventId, bookingId) {
  const { data } = await admin
    .from('event_bookings')
    .select('id, event_id, contact_id, slot_start, slot_end, pay_type, hourly_rate_cents, flat_amount_cents, status, contact:contact_id ( display_name )')
    .eq('id', bookingId)
    .eq('event_id', eventId)
    .maybeSingle();
  return data || null;
}

function gate(id, bookingId) {
  if (!UUID.test(id) || !UUID.test(bookingId)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }
  return null;
}

// PATCH — change an existing booking's slot times or pay rate.
export async function PATCH(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  const { id, bookingId } = await params;
  const bad = gate(id, bookingId);
  if (bad) return bad;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad body' }, { status: 400 });
  }

  const admin = createAdminClient();
  const booking = await loadBooking(admin, id, bookingId);
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  if (bookingPayInProgress(booking.status)) {
    return NextResponse.json(
      { error: 'This booking already has a pay request in progress — it can no longer be edited here.' },
      { status: 409 }
    );
  }

  const { valid, error: validationError, data: payload } = buildBookingPayload(body);
  if (!valid) return NextResponse.json({ error: validationError }, { status: 400 });

  const { error: updateError } = await admin
    .from('event_bookings')
    .update({ ...payload, updated_by: user.id })
    .eq('id', bookingId);

  if (updateError) {
    console.error('[event.bookings.update]', updateError);
    return NextResponse.json({ error: 'Could not update the booking' }, { status: 500 });
  }

  await auditBooking({
    admin,
    action: 'booking_updated',
    bookingId,
    actorId: user.id,
    actorEmail: user.email,
    request,
    details: {
      booking_id: bookingId,
      event_id: id,
      contact_id: booking.contact_id,
      contact_name: booking.contact?.display_name || null,
      before: {
        slot_start: booking.slot_start,
        slot_end: booking.slot_end,
        pay_type: booking.pay_type,
        hourly_rate_cents: booking.hourly_rate_cents,
        flat_amount_cents: booking.flat_amount_cents,
      },
      after: payload,
    },
  });

  const { bookings } = await loadEventBookings(admin, id);
  return NextResponse.json({ ok: true, bookings: bookings || null });
}

// DELETE — remove a booking outright. Blocked once a pay request exists for
// it (see bookingPayInProgress) — that history shouldn't disappear along with
// the booking it's about.
export async function DELETE(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  const { id, bookingId } = await params;
  const bad = gate(id, bookingId);
  if (bad) return bad;

  const admin = createAdminClient();
  const booking = await loadBooking(admin, id, bookingId);
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 });

  if (bookingPayInProgress(booking.status)) {
    return NextResponse.json(
      { error: 'This booking has an active or completed pay request — it can no longer be removed.' },
      { status: 409 }
    );
  }

  const { error: deleteError } = await admin.from('event_bookings').delete().eq('id', bookingId);
  if (deleteError) {
    console.error('[event.bookings.delete]', deleteError);
    return NextResponse.json({ error: 'Could not remove the booking' }, { status: 500 });
  }

  // Audited after the delete so a failed delete can't leave a
  // booking_cancelled row behind for a booking that still exists. The
  // booking_id COLUMN has to be null once the row is gone (ON DELETE SET
  // NULL), so the id rides in details instead — same reasoning as
  // auditGuestlist's grant_revoked rows.
  await auditBooking({
    admin,
    action: 'booking_cancelled',
    actorId: user.id,
    actorEmail: user.email,
    request,
    details: {
      booking_id: bookingId,
      event_id: id,
      contact_id: booking.contact_id,
      contact_name: booking.contact?.display_name || null,
      removed_booking: {
        slot_start: booking.slot_start,
        slot_end: booking.slot_end,
        pay_type: booking.pay_type,
        hourly_rate_cents: booking.hourly_rate_cents,
        flat_amount_cents: booking.flat_amount_cents,
      },
    },
  });

  const { bookings } = await loadEventBookings(admin, id);
  return NextResponse.json({ ok: true, bookings: bookings || null });
}

import { NextResponse } from 'next/server';
import { requirePartner } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { computeBookingAmountCents } from '@/lib/booking-helpers';
import { isPayRequestEligible } from '@/lib/pay-request-helpers';
import { notifyAdminsPayRequested } from '@/lib/pay-request-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/partner/bookings/:bookingId/request-pay — an artist tapping
// "Request Pay" on their own booking. Service-role write, gated by
// requirePartner(): there is no client-side insert policy on
// artist_pay_requests at all (see the Phase 3 migration header), so this
// route is the ONLY path a request row can be created through.
//
// Re-checks ownership, status, and the 15-minutes-after-slot_end eligibility
// window server-side even though the partner portal UI already hides the
// button until eligible — a network-tab POST against an ineligible or
// not-their-own booking must still be refused here.
export async function POST(request, { params }) {
  const { user, partner, unauthorized } = await requirePartner();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { bookingId } = await params;
  if (!UUID.test(bookingId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();

  const { data: booking, error: bookingError } = await admin
    .from('event_bookings')
    .select('id, event_id, contact_id, status, slot_start, slot_end, pay_type, hourly_rate_cents, flat_amount_cents')
    .eq('id', bookingId)
    .maybeSingle();

  if (bookingError || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }
  if (booking.contact_id !== partner.contact_id) {
    // Same posture as a partner hitting someone else's grant: 404, not 403 —
    // don't confirm the booking exists to a caller who has no business with it.
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }
  if (booking.status === 'cancelled') {
    return NextResponse.json({ error: 'This booking was cancelled.' }, { status: 400 });
  }
  if (!['scheduled', 'completed'].includes(booking.status)) {
    return NextResponse.json({ error: 'A pay request is already in progress for this booking.' }, { status: 400 });
  }
  if (!isPayRequestEligible(booking.slot_end)) {
    return NextResponse.json(
      { error: 'Request Pay unlocks 15 minutes after your set ends.' },
      { status: 400 }
    );
  }

  const amountCents = computeBookingAmountCents(booking);
  if (!amountCents || amountCents <= 0) {
    return NextResponse.json({ error: 'Could not compute a pay amount for this booking.' }, { status: 400 });
  }

  const { data: createdRequest, error: insertError } = await admin
    .from('artist_pay_requests')
    .insert({
      booking_id: booking.id,
      event_id: booking.event_id,
      contact_id: booking.contact_id,
      pay_type: booking.pay_type,
      amount_cents: amountCents,
      requested_by: user.id,
    })
    .select('id')
    .single();

  if (insertError) {
    // The partial unique index (booking_id where status in pending/approved)
    // is the backstop against a double-tap or a second device racing this
    // same request — surface it as a friendly message, not a 500.
    if (insertError.code === '23505') {
      return NextResponse.json({ error: 'A pay request is already in progress for this booking.' }, { status: 409 });
    }
    console.error('[pay-request.create]', insertError);
    return NextResponse.json({ error: 'Could not submit your pay request.' }, { status: 500 });
  }

  await admin.from('event_bookings').update({ status: 'pay_requested', updated_by: user.id }).eq('id', booking.id);

  await admin.from('artist_pay_audit_log').insert({
    action: 'pay_requested',
    request_id: createdRequest.id,
    booking_id: booking.id,
    actor_id: user.id,
    actor_email: user.email,
    ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    user_agent: request.headers.get('user-agent') || null,
    details: { amount_cents: amountCents, pay_type: booking.pay_type },
  });

  await notifyAdminsPayRequested({
    admin,
    request,
    contactId: booking.contact_id,
    eventId: booking.event_id,
    amountCents,
  });

  // Re-fetched through the caller's own session (not the admin client) so
  // partner_bookings()'s auth.uid()-scoped partner_contact_id() resolves —
  // the service-role key has no auth.uid() and would silently return zero
  // rows here.
  const supabase = await createClient();
  const { data: bookings } = await supabase.rpc('partner_bookings');
  return NextResponse.json({ ok: true, bookings: bookings || null }, { status: 201 });
}

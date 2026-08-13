import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyArtistPayReviewed } from '@/lib/pay-request-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/admin/pay-requests/:id/approve
//
// Sets the request AND the booking to 'approved'. This does NOT move money —
// Phase 4's Mercury wiring is what will later transition 'approved' -> 'paid'.
// The re-statement of `status = 'pending_review'` in the update's .eq() is
// the same race-closing trick auditGuestlist-adjacent routes use elsewhere:
// if two admins double-click Approve at once, the second write matches zero
// rows instead of double-approving.
export async function POST(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();

  const { data: payRequest } = await admin
    .from('artist_pay_requests')
    .select('id, booking_id, event_id, contact_id, amount_cents, status')
    .eq('id', id)
    .maybeSingle();

  if (!payRequest) return NextResponse.json({ error: 'Pay request not found' }, { status: 404 });
  if (payRequest.status !== 'pending_review') {
    return NextResponse.json({ error: 'This request has already been reviewed.' }, { status: 400 });
  }

  const { data: updated, error: updateError } = await admin
    .from('artist_pay_requests')
    .update({ status: 'approved', reviewed_by: user.id, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending_review')
    .select('id')
    .maybeSingle();

  if (updateError || !updated) {
    console.error('[pay-requests.approve]', updateError);
    return NextResponse.json({ error: 'Could not approve this request.' }, { status: 500 });
  }

  await admin
    .from('event_bookings')
    .update({ status: 'approved', updated_by: user.id })
    .eq('id', payRequest.booking_id);

  await admin.from('artist_pay_audit_log').insert({
    action: 'pay_approved',
    request_id: payRequest.id,
    booking_id: payRequest.booking_id,
    actor_id: user.id,
    actor_email: user.email,
    ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    user_agent: request.headers.get('user-agent') || null,
    details: { amount_cents: payRequest.amount_cents },
  });

  await notifyArtistPayReviewed({
    admin,
    request,
    contactId: payRequest.contact_id,
    eventId: payRequest.event_id,
    amountCents: payRequest.amount_cents,
    decision: 'approved',
  });

  return NextResponse.json({ ok: true });
}

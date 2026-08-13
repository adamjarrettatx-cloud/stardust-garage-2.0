import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/admin/bookings/:bookingId/reopen — admin-only "Reopen for
// Payment" per the plan's 3.3.1. Only valid from 'rejected': resets the
// booking back to 'completed' so the artist's Request Pay button reappears
// (they were already 15+ minutes past slot_end to have requested the first
// time, so eligibility is immediately true again — no new wait).
//
// Does not touch the rejected artist_pay_requests row itself; that row stays
// exactly as it is for the audit trail (including its rejection_reason). A
// fresh request creates a brand new row — see the partial unique index note
// in the Phase 3 migration.
export async function POST(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  const { bookingId } = await params;
  if (!UUID.test(bookingId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();

  const { data: updated, error: updateError } = await admin
    .from('event_bookings')
    .update({ status: 'completed', updated_by: user.id })
    .eq('id', bookingId)
    .eq('status', 'rejected')
    .select('id, event_id')
    .maybeSingle();

  if (updateError) {
    console.error('[bookings.reopen]', updateError);
    return NextResponse.json({ error: 'Could not reopen this booking.' }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'Only a rejected booking can be reopened for payment.' }, { status: 400 });
  }

  await admin.from('artist_pay_audit_log').insert({
    action: 'pay_reopened',
    booking_id: bookingId,
    actor_id: user.id,
    actor_email: user.email,
    ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    user_agent: request.headers.get('user-agent') || null,
    details: null,
  });

  return NextResponse.json({ ok: true, booking: updated });
}

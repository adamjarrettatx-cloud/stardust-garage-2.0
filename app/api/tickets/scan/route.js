import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireTeam } from '@/lib/auth-helpers';
import { isTicketScannerEnabled, isInternalTicketingEnabled } from '@/lib/feature-flags';
import { rateLimit, keyFromRequest } from '@/lib/rate-limit';
import { normalizeTicketCode } from '@/lib/tickets/codes';
import {
  validateTicketScan,
  CHECKIN_RESULTS,
  isValidRejectReason,
} from '@/lib/tickets/checkin';
import { buildBuyerPreview } from '@/lib/tickets/buyer-preview';

// POST /api/tickets/scan
//
// Body shape (mode gates the behavior):
//
//   1. mode: 'preview' (default when omitted)
//      { code, event_id, device_label?, mode: 'preview' }
//      Validates the ticket + returns buyer name/email + a signed URL to the
//      buyer's profile photo so door staff can visually verify the person.
//      Does NOT flip tickets.status. The scanner UI then presents:
//        - Big Check In button   → follow-up POST with mode:'checkin'
//        - Reject Buyer Not Present → follow-up POST with mode:'reject'
//
//   2. mode: 'checkin'
//      { code, event_id, device_label?, mode: 'checkin', override?, note? }
//      Atomically flips tickets.status to 'used' (or errors out with
//      already_used etc). Logs to ticket_checkins with result='valid' or
//      'override'.
//
//   3. mode: 'reject'
//      { code, event_id, device_label?, mode: 'reject', reject_reason, note? }
//      Logs a rejection into ticket_checkins with result='rejected' and the
//      supplied reason. Does NOT flip tickets.status \u2014 the actual buyer
//      can still enter if the rejected person was a friend they forwarded
//      the QR to.
//
// `override=true` requires an admin caller and is only honored on
// mode:'checkin' when the decision would otherwise be non-valid.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_MODES = new Set(['preview', 'checkin', 'reject']);

export async function POST(request) {
  if (!isInternalTicketingEnabled() || !isTicketScannerEnabled()) {
    return NextResponse.json({ error: 'Scanner disabled' }, { status: 404 });
  }

  const rl = rateLimit({ key: keyFromRequest(request, 'ticket_scan'), limit: 300, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many scans' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const gate = await requireTeam();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { user, isAdmin } = gate;

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const rawCode = body?.code;
  const eventId = body?.event_id;
  const deviceLabel = body?.device_label || null;
  const wantOverride = body?.override === true;
  const note = body?.note || null;
  const mode = body?.mode && VALID_MODES.has(body.mode) ? body.mode : 'preview';
  const rejectReason = body?.reject_reason || null;

  const code = normalizeTicketCode(rawCode);
  if (!code || !eventId) {
    return NextResponse.json({ error: 'Missing code or event_id' }, { status: 400 });
  }
  if (mode === 'reject' && !isValidRejectReason(rejectReason)) {
    return NextResponse.json(
      { error: 'Missing or invalid reject_reason. Allowed: photo_mismatch, no_photo_on_file, id_mismatch, manual.' },
      { status: 400 },
    );
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: ticket } = await supabaseAdmin
    .from('tickets')
    .select('id, order_id, event_id, product_id, status, used_at')
    .eq('ticket_code', code)
    .maybeSingle();

  const decision = validateTicketScan({ ticket, eventId });

  // ------------------------------------------------------------------
  // mode: 'preview' \u2014 return decision + buyer preview, no side effects.
  // ------------------------------------------------------------------
  if (mode === 'preview') {
    const buyer = await buildBuyerPreview(supabaseAdmin, ticket);
    return NextResponse.json({
      mode: 'preview',
      result: decision.result,
      reason: decision.reason,
      ticket: ticket
        ? { id: ticket.id, status: ticket.status, used_at: ticket.used_at }
        : null,
      buyer,
    });
  }

  // ------------------------------------------------------------------
  // mode: 'reject' \u2014 log the rejection, do NOT flip ticket status.
  // Allowed even if the ticket lookup itself was NOT_FOUND \u2014 staff
  // reject the person, not the ticket.
  // ------------------------------------------------------------------
  if (mode === 'reject') {
    await supabaseAdmin.from('ticket_checkins').insert({
      ticket_id: ticket?.id || null,
      event_id: eventId,
      ticket_code_attempted: code,
      result: CHECKIN_RESULTS.REJECTED,
      reject_reason: rejectReason,
      scanned_by: user.id,
      device_label: deviceLabel,
      note,
    });
    return NextResponse.json({
      mode: 'reject',
      result: CHECKIN_RESULTS.REJECTED,
      reject_reason: rejectReason,
      ticket: ticket ? { id: ticket.id, status: ticket.status } : null,
    });
  }

  // ------------------------------------------------------------------
  // mode: 'checkin' \u2014 flip status + log, with optional admin override.
  // ------------------------------------------------------------------
  let effective = decision.result;
  if (wantOverride && isAdmin && effective !== CHECKIN_RESULTS.VALID) {
    effective = CHECKIN_RESULTS.OVERRIDE;
  }

  await supabaseAdmin.from('ticket_checkins').insert({
    ticket_id: ticket?.id || null,
    event_id: eventId,
    ticket_code_attempted: code,
    result: effective,
    scanned_by: user.id,
    device_label: deviceLabel,
    note,
  });

  if (effective === CHECKIN_RESULTS.VALID) {
    const { data: flipped } = await supabaseAdmin
      .from('tickets')
      .update({ status: 'used', used_at: new Date().toISOString() })
      .eq('id', ticket.id)
      .eq('status', 'valid') // race guard
      .select('id')
      .maybeSingle();
    if (!flipped) {
      await supabaseAdmin.from('ticket_checkins').insert({
        ticket_id: ticket.id,
        event_id: eventId,
        ticket_code_attempted: code,
        result: CHECKIN_RESULTS.ALREADY_USED,
        scanned_by: user.id,
        device_label: deviceLabel,
        note: 'lost_race',
      });
      return NextResponse.json({
        mode: 'checkin',
        result: CHECKIN_RESULTS.ALREADY_USED,
        reason: 'LOST_RACE',
      });
    }
  }

  if (effective === CHECKIN_RESULTS.OVERRIDE) {
    await supabaseAdmin.from('ticket_audit_log').insert({
      event_id: eventId,
      order_id: ticket?.order_id || null,
      ticket_id: ticket?.id || null,
      actor_user_id: user.id,
      actor_role: 'admin',
      action: 'checkin.override',
      detail: { reason: decision.reason, note },
    });
  }

  return NextResponse.json({
    mode: 'checkin',
    result: effective,
    reason: decision.reason,
    ticket: ticket
      ? {
          id: ticket.id,
          status: effective === CHECKIN_RESULTS.VALID || effective === CHECKIN_RESULTS.OVERRIDE
            ? 'used'
            : ticket.status,
        }
      : null,
  });
}

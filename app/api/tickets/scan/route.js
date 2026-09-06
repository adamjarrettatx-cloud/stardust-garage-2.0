import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireTeam } from '@/lib/auth-helpers';
import { isTicketScannerEnabled, isInternalTicketingEnabled } from '@/lib/feature-flags';
import { rateLimit, keyFromRequest } from '@/lib/rate-limit';
import { normalizeTicketCode } from '@/lib/tickets/codes';
import { validateTicketScan, CHECKIN_RESULTS } from '@/lib/tickets/checkin';

// POST /api/tickets/scan
// Body: { code, event_id, device_label?, override?, note? }
//
// Team-only endpoint that validates a scanned ticket code, records the
// attempt into ticket_checkins (audit), and — on VALID — flips
// tickets.status to 'used'.
//
// `override=true` requires an admin caller and forces success even if the
// ticket was previously used; this is logged as CHECKIN_RESULTS.OVERRIDE
// so we always have the paper trail.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  if (!isInternalTicketingEnabled() || !isTicketScannerEnabled()) {
    return NextResponse.json({ error: 'Scanner disabled' }, { status: 404 });
  }

  const rl = rateLimit({ key: keyFromRequest(request, 'ticket_scan'), limit: 300, windowMs: 60_000 });
  if (!rl.ok) return NextResponse.json({ error: 'Too many scans' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } });

  // requireTeam returns { user, teamRole, isAdmin, unauthorized }.
  const gate = await requireTeam();
  if (gate.unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { user, isAdmin } = gate;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const rawCode = body?.code;
  const eventId = body?.event_id;
  const deviceLabel = body?.device_label || null;
  const wantOverride = body?.override === true;
  const note = body?.note || null;

  const code = normalizeTicketCode(rawCode);
  if (!code || !eventId) return NextResponse.json({ error: 'Missing code or event_id' }, { status: 400 });

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Lock the ticket row for the state transition. Postgres transaction via
  // supabase-js: emulate with select-then-update guarded by status='valid'
  // in the WHERE clause so two concurrent scanners only ever get one VALID.
  const { data: ticket } = await supabaseAdmin
    .from('tickets')
    .select('id, order_id, event_id, product_id, status, used_at')
    .eq('ticket_code', code)
    .maybeSingle();

  const decision = validateTicketScan({ ticket, eventId });

  // Override path: admin explicitly opted in on a non-valid ticket.
  let effective = decision.result;
  if (wantOverride && isAdmin && effective !== CHECKIN_RESULTS.VALID) {
    effective = CHECKIN_RESULTS.OVERRIDE;
  }

  // Persist the attempt.
  await supabaseAdmin.from('ticket_checkins').insert({
    ticket_id: ticket?.id || null,
    event_id: eventId,
    ticket_code_attempted: code,
    result: effective,
    scanned_by: user.id,
    device_label: deviceLabel,
    note,
  });

  // On VALID: flip status to 'used' atomically. If someone else already
  // flipped it, downgrade the response to ALREADY_USED so the door operator
  // sees the truth.
  if (effective === CHECKIN_RESULTS.VALID) {
    const { data: flipped } = await supabaseAdmin
      .from('tickets')
      .update({ status: 'used', used_at: new Date().toISOString() })
      .eq('id', ticket.id)
      .eq('status', 'valid')  // race guard
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
      return NextResponse.json({ result: CHECKIN_RESULTS.ALREADY_USED, reason: 'LOST_RACE' });
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
    result: effective,
    reason: decision.reason,
    ticket: ticket
      ? {
          id: ticket.id,
          status: effective === CHECKIN_RESULTS.VALID || effective === CHECKIN_RESULTS.OVERRIDE ? 'used' : ticket.status,
        }
      : null,
  });
}

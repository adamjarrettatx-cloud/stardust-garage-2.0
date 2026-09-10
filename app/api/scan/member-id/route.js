import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireTeam, getCurrentUser } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { rateLimit, keyFromRequest } from '@/lib/rate-limit';
import {
  hashMemberIdentityToken,
  isWellFormedMemberIdentityToken,
} from '@/lib/member-identity';
import {
  buildMemberIdPreview,
  isValidMemberIdRejectReason,
} from '@/lib/member-id-preview';
import { findMemberLinkedTicket } from '@/lib/member-id-linked-ticket';
import { CHECKIN_RESULTS } from '@/lib/tickets/checkin';

// POST /api/scan/member-id
//
// Body shape (mode gates the behavior) \u2014 mirrors /api/tickets/scan and
// /api/capacity/trial-pass/scan:
//
//   1. mode: 'preview' (default when omitted)
//      { token, event_id?, device_label?, mode: 'preview' }
//      Resolves the identity token \u2192 member row + face photo signed URL.
//      Returns the preview card the unified scanner UI renders. NO writes.
//
//   2. mode: 'verify'
//      { token, event_id?, device_label?, mode: 'verify', note? }
//      Logs the door decision as 'verified' in member_id_scans. Does NOT
//      flip any membership state \u2014 a member scan is pure audit, the same
//      badge is scanned every visit.
//
//   3. mode: 'reject'
//      { token, event_id?, device_label?, mode: 'reject', reject_reason, note? }
//      Logs 'rejected' with a whitelisted reason.
//
// Unlike ticket check-in, there is no 'used' state to protect and no
// atomic race \u2014 the same badge is legitimately scanned by every event
// the member attends. Ordering does not matter; the log is append-only.
//
// Auth: requires a team caller. No device-token path here \u2014 the
// door scanner is a supervised device.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_MODES = new Set(['preview', 'verify', 'reject']);

export async function POST(request) {
  if (!isInternalTicketingEnabled()) {
    return NextResponse.json({ error: 'Scanner disabled' }, { status: 404 });
  }

  const rl = rateLimit({
    key: keyFromRequest(request, 'member_id_scan'),
    limit: 300,
    windowMs: 60_000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many scans' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const gate = await requireTeam(request);
  if (gate?.unauthorized) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const mode = typeof body?.mode === 'string' && VALID_MODES.has(body.mode) ? body.mode : 'preview';
  const eventId = typeof body?.event_id === 'string' ? body.event_id : null;
  const deviceLabel = typeof body?.device_label === 'string' ? body.device_label.slice(0, 120) : null;
  const rejectReason = typeof body?.reject_reason === 'string' ? body.reject_reason.trim() : '';
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 280) : '';
  const doorSessionId = typeof body?.door_session_id === 'string' && body.door_session_id ? body.door_session_id : null;

  if (!isWellFormedMemberIdentityToken(token)) {
    return NextResponse.json({ error: 'Not a Member ID QR' }, { status: 400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // Resolve the token \u2192 member.
  const tokenHash = hashMemberIdentityToken(token);
  const { data: tokenRow } = await admin
    .from('member_identity_tokens')
    .select('member_profile_id, revoked_at, revoke_reason')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (!tokenRow) {
    return NextResponse.json({ error: 'Unknown Member ID' }, { status: 404 });
  }
  if (tokenRow.revoked_at) {
    return NextResponse.json(
      { error: 'This Member ID has been revoked', revoke_reason: tokenRow.revoke_reason },
      { status: 410 },
    );
  }

  const { data: member } = await admin
    .from('member_profiles')
    .select('id, user_id, full_name, email, profile_photo_path, photo_url, subscription_plan, subscription_status, is_active')
    .eq('id', tokenRow.member_profile_id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  // MODE: preview \u2014 pure read + photo signed URL, no writes.
  //
  // When an event_id is set (staff picked "scanning for this event") we
  // also look up whether this member has a redeemable ticket for that
  // event. If they do, the preview card lets staff see "Ticket: General
  // Admission \u2014 will be checked in" so one scan does both.
  if (mode === 'preview') {
    const preview = await buildMemberIdPreview(admin, member);
    const linkedTicket = eventId
      ? await findMemberLinkedTicket(admin, {
          memberProfileId: member.id,
          memberEmail: member.email,
          eventId,
        })
      : { ticket: null, productLabel: null, matchedVia: null, candidateCount: 0 };
    return NextResponse.json({
      mode: 'preview',
      member: preview,
      linked_ticket: linkedTicket.ticket
        ? {
            ticket_id: linkedTicket.ticket.id,
            ticket_code: linkedTicket.ticket.ticket_code,
            product_label: linkedTicket.productLabel,
            matched_via: linkedTicket.matchedVia,
            candidate_count: linkedTicket.candidateCount,
          }
        : null,
    });
  }

  // MODE: reject \u2014 log the rejection. Does not change membership state.
  if (mode === 'reject') {
    if (!isValidMemberIdRejectReason(rejectReason)) {
      return NextResponse.json({ error: 'Invalid reject reason' }, { status: 400 });
    }
    const { user } = await getCurrentUser(request);
    const { error } = await admin.from('member_id_scans').insert({
      member_profile_id: member.id,
      event_id: eventId,
      result: 'rejected',
      reject_reason: rejectReason,
      notes: note || null,
      scanned_by: user?.id || null,
      door_device_id: deviceLabel,
      door_session_id: doorSessionId,
    });
    if (error) {
      console.error('[member-id-scan.reject]', error.message);
      return NextResponse.json({ error: 'Failed to log rejection' }, { status: 500 });
    }
    return NextResponse.json({ mode: 'reject', result: 'rejected', reject_reason: rejectReason });
  }

  // MODE: verify \u2014 log the verified member scan AND, if the member has
  // a ticket for the current event, redeem that ticket in the same call.
  // One QR, one tap, both credentials cleared.
  const { user } = await getCurrentUser(request);

  // Look up linked ticket first so we can attempt the atomic ticket flip
  // BEFORE we log the member scan. This ordering means: if the ticket flip
  // loses a race (someone else scanned the same buyer at another door),
  // the member scan still gets logged \u2014 they still walk in on their
  // member credential \u2014 but we surface a "ticket already used" note so
  // staff know the redemption didn't happen here.
  const linkedTicket = eventId
    ? await findMemberLinkedTicket(admin, {
        memberProfileId: member.id,
        memberEmail: member.email,
        eventId,
      })
    : { ticket: null, productLabel: null, matchedVia: null, candidateCount: 0 };

  let ticketOutcome = null; // { result, ticket_id, product_label, matched_via }
  if (linkedTicket.ticket) {
    const nowIso = new Date().toISOString();
    const { data: flipped } = await admin
      .from('tickets')
      .update({ status: 'used', used_at: nowIso })
      .eq('id', linkedTicket.ticket.id)
      .eq('status', 'valid') // race guard
      .select('id')
      .maybeSingle();

    const chosenResult = flipped ? CHECKIN_RESULTS.VALID : CHECKIN_RESULTS.ALREADY_USED;

    // Log the ticket-side check-in in ticket_checkins so the door log
    // matches what /api/tickets/scan writes for the manual path.
    await admin.from('ticket_checkins').insert({
      ticket_id: linkedTicket.ticket.id,
      event_id: eventId,
      ticket_code_attempted: linkedTicket.ticket.ticket_code,
      result: chosenResult,
      scanned_by: user?.id || null,
      device_label: deviceLabel,
      door_session_id: doorSessionId,
      note: flipped
        ? `via_member_id (matched=${linkedTicket.matchedVia})`
        : 'via_member_id lost_race',
    });

    ticketOutcome = {
      result: chosenResult,
      ticket_id: linkedTicket.ticket.id,
      product_label: linkedTicket.productLabel,
      matched_via: linkedTicket.matchedVia,
    };
  }

  const { error } = await admin.from('member_id_scans').insert({
    member_profile_id: member.id,
    event_id: eventId,
    result: 'verified',
    reject_reason: null,
    notes: note || null,
    scanned_by: user?.id || null,
    door_device_id: deviceLabel,
    door_session_id: doorSessionId,
  });
  if (error) {
    console.error('[member-id-scan.verify]', error.message);
    return NextResponse.json({ error: 'Failed to log verification' }, { status: 500 });
  }

  // Fire a silent in-app notification confirming the door check-in. Wrapped
  // in a try so a notification failure never blocks the door.
  try {
    const { notify } = await import('@/lib/notifications/send');
    if (member.user_id) {
      await notify(admin, {
        userId: member.user_id,
        type: 'door_checkin',
        title: 'You\u2019re in',
        body: 'Welcome to Stardust Garage',
        data: { event_id: eventId, url: '/notifications' },
      });
    }
  } catch (err) {
    console.error('[member-id-scan.notify]', err?.message || err);
  }

  return NextResponse.json({
    mode: 'verify',
    result: 'verified',
    member: {
      memberProfileId: member.id,
      firstName: (member.full_name || 'Member').split(/\s+/)[0],
      isActive: Boolean(member.is_active),
    },
    ticket: ticketOutcome,
  });
}

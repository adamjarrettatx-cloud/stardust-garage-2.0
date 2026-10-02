import { NextResponse } from 'next/server';
import { fetchPriorDenials, fetchDoorSessionStart } from '@/lib/capacity/denial-lookup';
import { createClient } from '@supabase/supabase-js';
import { requireFrontDeskOrTeam, getCurrentUser } from '@/lib/auth-helpers';
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
import { commitAdmission } from '@/lib/capacity/commit-admission';

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
//      Requires the active door event, eligible pass, photo and valid ticket.
//      Admission, ticket use, scan history and capacity commit together.
//
//   3. mode: 'reject'
//      { token, event_id?, device_label?, mode: 'reject', reject_reason, note? }
//      Logs 'rejected' with a whitelisted reason.
//
// The badge is reusable across events, not across admissions to the same
// event. A repeat returns already-used without consuming another group ticket.
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

  const gate = await requireFrontDeskOrTeam(request);
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
  if (mode === 'verify') {
    return commitAdmission(admin, {
      actorId: gate.user?.id, stationHash: gate.station?.sessionHash, kind: 'member', subjectId: member.id,
      tokenHash, eventId, sessionId: doorSessionId, ticketCode: body.ticket_code,
    });
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
    // Prior denials for the PERSON, all-time. Never allowed to fail the scan.
    let priorDenials = [];
    let sessionStartedAt = null;
    try {
      [priorDenials, sessionStartedAt] = await Promise.all([
        fetchPriorDenials(admin, { kind: 'member_id', memberProfileId: member.id }),
        fetchDoorSessionStart(admin, doorSessionId),
      ]);
    } catch (err) {
      console.error('[member-id-scan.priorDenials]', err?.message || err);
    }
    return NextResponse.json({
      access_subject: { kind: 'member', id: member.id },
      mode: 'preview',
      member: preview,
      prior_denials: priorDenials,
      session_started_at: sessionStartedAt,
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
    // `.select('id')` so the feed keys this denial on the SCAN, not the member.
    const { data: rejectRow, error } = await admin.from('member_id_scans').insert({
      member_profile_id: member.id,
      event_id: eventId,
      result: 'rejected',
      reject_reason: rejectReason,
      notes: note || null,
      scanned_by: user?.id || null,
      door_device_id: deviceLabel,
      door_session_id: doorSessionId,
    }).select('id').maybeSingle();
    if (error) {
      console.error('[member-id-scan.reject]', error.message);
      return NextResponse.json({ error: 'Failed to log rejection' }, { status: 500 });
    }
    return NextResponse.json({
      mode: 'reject',
      result: 'rejected',
      reject_reason: rejectReason,
      checkin_id: rejectRow?.id || null,
    });
  }

  return NextResponse.json({ error: 'Unsupported scan mode.' }, { status: 400 });
}

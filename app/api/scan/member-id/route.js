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

  const gate = await requireTeam();
  if (gate?.error) {
    return NextResponse.json({ error: gate.error }, { status: gate.status || 401 });
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
    .select('id, full_name, email, profile_photo_path, photo_url, subscription_plan, subscription_status, is_active')
    .eq('id', tokenRow.member_profile_id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  // MODE: preview \u2014 pure read + photo signed URL, no writes.
  if (mode === 'preview') {
    const preview = await buildMemberIdPreview(admin, member);
    return NextResponse.json({ mode: 'preview', member: preview });
  }

  // MODE: reject \u2014 log the rejection. Does not change membership state.
  if (mode === 'reject') {
    if (!isValidMemberIdRejectReason(rejectReason)) {
      return NextResponse.json({ error: 'Invalid reject reason' }, { status: 400 });
    }
    const { user } = await getCurrentUser();
    const { error } = await admin.from('member_id_scans').insert({
      member_profile_id: member.id,
      event_id: eventId,
      result: 'rejected',
      reject_reason: rejectReason,
      notes: note || null,
      scanned_by: user?.id || null,
      door_device_id: deviceLabel,
    });
    if (error) {
      console.error('[member-id-scan.reject]', error.message);
      return NextResponse.json({ error: 'Failed to log rejection' }, { status: 500 });
    }
    return NextResponse.json({ mode: 'reject', result: 'rejected', reject_reason: rejectReason });
  }

  // MODE: verify \u2014 log the verified scan.
  const { user } = await getCurrentUser();
  const { error } = await admin.from('member_id_scans').insert({
    member_profile_id: member.id,
    event_id: eventId,
    result: 'verified',
    reject_reason: null,
    notes: note || null,
    scanned_by: user?.id || null,
    door_device_id: deviceLabel,
  });
  if (error) {
    console.error('[member-id-scan.verify]', error.message);
    return NextResponse.json({ error: 'Failed to log verification' }, { status: 500 });
  }

  return NextResponse.json({
    mode: 'verify',
    result: 'verified',
    member: {
      memberProfileId: member.id,
      firstName: (member.full_name || 'Member').split(/\s+/)[0],
      isActive: Boolean(member.is_active),
    },
  });
}

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { requireTeam } from '@/lib/auth-helpers';
import { resolveDeviceFromToken } from '@/lib/capacity-device-auth';
import { extractDeviceToken } from '@/lib/capacity-device-utils';
import {
  DOOR_RESULTS,
  daysRemaining,
  effectiveExpiry,
  evaluateDoorScan,
  formatPassDate,
  hashPassToken,
  isWellFormedPassToken,
  passStatusLabel,
} from '@/lib/trial-pass';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/capacity/trial-pass/scan
// Body: { token, eventId? }
// Auth: a team Supabase session OR a front-door device token.
//
// What the door hits when a guest holds up their pass. The scanner is
// authoritative: the QR carries nothing but an opaque token, so every
// allow/deny decision is made here against the live row, and a screenshot of a
// pass that was valid last month denies on the spot.
//
// The decision itself is evaluateDoorScan() in lib/trial-pass.js — pure, no
// database, unit tested. This route's job is to authorise the scanner, resolve
// the token to a row, ask that function, and write the attempt down.
//
// Two auth paths on purpose, matching the rest of the capacity surface: staff
// working from a logged-in tablet at /capacity/front-door, and the Jelly2 door
// phones that hold a device token instead of a session. An exit_door token is
// refused — checking a trial pass is an entry decision.
//
// The response is deliberately thin: first name, decision, expiry, days left.
// The door needs to know "let them in or not" and who they are looking at. It
// does not need the guest's email, phone, or row id, so it never receives them.
export async function POST(request) {
  const url = new URL(request.url);
  const deviceToken = extractDeviceToken({
    authHeader: request.headers.get('authorization'),
    queryToken: url.searchParams.get('token'),
  });

  let staffUserId = null;
  let device = null;

  if (deviceToken) {
    device = await resolveDeviceFromToken(deviceToken);
    if (!device) {
      return NextResponse.json({ error: 'Device not authorized', code: 'forbidden' }, { status: 401 });
    }
    if (device.role !== 'front_door') {
      return NextResponse.json(
        { error: 'This device cannot check trial passes.', code: 'forbidden' },
        { status: 403 },
      );
    }
  } else {
    const { user, unauthorized } = await requireTeam();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized', code: 'forbidden' }, { status: 401 });
    }
    staffUserId = user?.id || null;
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'bad_input' }, { status: 400 });
  }

  const passToken = typeof body?.token === 'string' ? body.token.trim() : '';
  const eventId = typeof body?.eventId === 'string' && UUID.test(body.eventId) ? body.eventId : null;

  // A scan of some other QR entirely — a Ticket Tailor code, a wifi sticker,
  // a bottle label. Answered as "not a pass" rather than "denied", because the
  // attendant needs to know to scan something else, not to turn someone away.
  if (!isWellFormedPassToken(passToken)) {
    return NextResponse.json({ ok: false, result: 'not_a_pass', reason: 'That is not an SDG trial pass.' });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured.', code: 'error' }, { status: 500 });
  }

  const admin = createAdminClient();

  const { data: pass, error: passError } = await admin
    .from('trial_passes')
    .select('id, full_name, status, issued_at, expires_at, extended_until, applied_at, converted_at')
    .eq('qr_token_hash', hashPassToken(passToken))
    .maybeSingle();

  if (passError) {
    console.error('[door.trial-pass.scan.lookup]', passError);
    return NextResponse.json({ error: 'Could not check that pass.', code: 'error' }, { status: 500 });
  }
  if (!pass) {
    // Well-formed but unknown: a revoked pass, or a token from a reissue where
    // the guest is showing the older screenshot. Same answer either way.
    return NextResponse.json({ ok: false, result: 'not_a_pass', reason: 'This pass is no longer valid.' });
  }

  // Event context, when the door passed one. Used for the Friday–Sunday music
  // rule and for the one-scan-per-event guard.
  let event = null;
  if (eventId) {
    const { data: eventRow, error: eventError } = await admin
      .from('events')
      .select('id, title, event_date, category')
      .eq('id', eventId)
      .maybeSingle();
    if (eventError) {
      console.error('[door.trial-pass.scan.event]', eventError);
    } else {
      event = eventRow;
    }
  }

  // Has this pass already been let in tonight? Only 'allowed' rows count — a
  // guest who was denied and then sorted it out with staff is not blocked as a
  // duplicate.
  let alreadyCheckedIn = false;
  if (eventId) {
    const { count, error: dupeError } = await admin
      .from('trial_pass_checkins')
      .select('id', { count: 'exact', head: true })
      .eq('trial_pass_id', pass.id)
      .eq('event_id', eventId)
      .eq('result', DOOR_RESULTS.allowed);
    if (dupeError) {
      console.error('[door.trial-pass.scan.dupe]', dupeError);
    } else {
      alreadyCheckedIn = (count || 0) > 0;
    }
  }

  const decision = evaluateDoorScan({ pass, event, alreadyCheckedIn, now: new Date() });

  // Every scan is written down, allowed or not. Denials are the useful half of
  // this table: they are how Adam finds out that the trial window is too short,
  // or that people keep turning up on nights the pass does not cover.
  const { error: logError } = await admin.from('trial_pass_checkins').insert({
    trial_pass_id: pass.id,
    event_id: eventId,
    result: decision.result,
    checked_in_by: staffUserId,
    door_device_id: device?.id || null,
  });
  if (logError && logError.code !== '23505') {
    // 23505 is the one-allowed-scan-per-event unique index doing its job under
    // a double-tap; the decision above stands either way.
    console.error('[door.trial-pass.scan.log]', logError);
  }

  const expiry = effectiveExpiry(pass);

  return NextResponse.json({
    ok: decision.allowed,
    result: decision.result,
    reason: decision.reason,
    staffAction: decision.staffAction || null,
    guest: {
      // First name only. Enough for the attendant to greet them and match the
      // face to the phone; not a contact record handed to a door device.
      firstName: String(pass.full_name || '').split(' ')[0] || null,
      statusLabel: passStatusLabel(pass),
      expiresLabel: expiry ? formatPassDate(expiry) : null,
      daysLeft: daysRemaining(pass),
    },
    event: event ? { id: event.id, title: event.title, date: event.event_date } : null,
  });
}

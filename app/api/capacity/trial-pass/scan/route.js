import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { requireTeam } from '@/lib/auth-helpers';
import { resolveDeviceFromToken } from '@/lib/capacity-device-auth';
import { extractDeviceToken } from '@/lib/capacity-device-utils';
import { resolveSiteUrl } from '@/lib/site-url';
import { sendTrialPassApplicationInvite } from '@/lib/email';
import {
  DOOR_RESULTS,
  TRIAL_WINDOW_DAYS,
  daysRemaining,
  effectiveExpiry,
  evaluateDoorScan,
  formatPassDate,
  hashPassToken,
  isWellFormedPassToken,
  passStatusLabel,
} from '@/lib/trial-pass';
import { REJECT_REASONS, isValidRejectReason } from '@/lib/tickets/checkin.js';
import { buildTrialPassPreview } from '@/lib/tickets/trial-pass-preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_MODES = new Set(['preview', 'checkin', 'reject']);

// POST /api/capacity/trial-pass/scan
// Body: { token, eventId?, mode? = 'preview', reject_reason?, note? }
// Auth: a team Supabase session OR a front-door device token.
//
// What the door hits when a guest holds up their pass. The scanner is
// authoritative: the QR carries nothing but an opaque token, so every
// allow/deny decision is made here against the live row.
//
// Three modes, mirroring /api/tickets/scan:
//
//   mode = 'preview' (default when omitted)
//     Validate the token and evaluate the door decision, but write NOTHING
//     down. Return the guest's first name + face photo (signed URL) so the
//     operator can compare against the person in front of them BEFORE they
//     commit. Does NOT activate the pass, does NOT send the application
//     invite email, does NOT bump capacity. This is the safe default so a
//     bare code-only POST no longer auto-consumes a pass.
//
//   mode = 'checkin'
//     The full "let them in" flow: log the check-in, activate the pass on
//     first allowed scan, fire the one-shot application-invite email. Only
//     called when staff hits "Check In" after seeing the photo.
//
//   mode = 'reject'
//     Staff saw the photo and this is not the right person. Requires a
//     whitelisted reject_reason. Logs the rejection with an optional note.
//     Does NOT activate the pass and does NOT change its state, so the real
//     guest can re-scan later and get through cleanly.
//
// The decision itself is evaluateDoorScan() in lib/trial-pass.js — pure, no
// database, unit tested. This route's job is to authorise the scanner, resolve
// the token to a row, ask that function, and (in checkin mode) write the
// attempt down.
//
// Two auth paths on purpose, matching the rest of the capacity surface: staff
// working from a logged-in tablet at /capacity/front-door, and the Jelly2 door
// phones that hold a device token instead of a session. An exit_door token is
// refused — checking a trial pass is an entry decision.
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
  const mode = typeof body?.mode === 'string' && VALID_MODES.has(body.mode) ? body.mode : 'preview';
  const rejectReason = typeof body?.reject_reason === 'string' ? body.reject_reason.trim() : '';
  const rejectNote = typeof body?.note === 'string' ? body.note.trim().slice(0, 280) : '';

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

  let { data: pass, error: passError } = await admin
    .from('trial_passes')
    .select('id, full_name, email, status, issued_at, expires_at, extended_until, applied_at, converted_at, activated_at, signup_expires_at, profile_photo_path')
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
  const expiryBeforeActivation = effectiveExpiry(pass);

  // --------------------------------------------------------------------------
  // MODE: preview  (default) — pure read + photo lookup, no writes
  //
  // Return the door decision and the buyer's photo. Nothing hits the DB
  // outside the SELECTs already run above.
  // --------------------------------------------------------------------------
  if (mode === 'preview') {
    const preview = await buildTrialPassPreview(admin, pass);
    return NextResponse.json({
      ok: decision.allowed,
      mode: 'preview',
      result: decision.result,
      reason: decision.reason,
      staffAction: decision.staffAction || null,
      guest: {
        // First name only. Enough for the attendant to greet them and match
        // the face to the phone; not a contact record handed to a door device.
        firstName: preview.firstName,
        statusLabel: passStatusLabel(pass),
        expiresLabel: expiryBeforeActivation ? formatPassDate(expiryBeforeActivation) : null,
        daysLeft: daysRemaining(pass),
        hasPhoto: preview.hasPhoto,
        photoSignedUrl: preview.photoSignedUrl,
      },
      event: event ? { id: event.id, title: event.title, date: event.event_date } : null,
    });
  }

  // --------------------------------------------------------------------------
  // MODE: reject — log rejection, do NOT activate the pass
  //
  // Staff saw the photo and this is not the right person. We log the attempt
  // so Adam can audit reject rates later, but the pass row is untouched —
  // the real guest can walk up next and their scan still activates cleanly.
  // --------------------------------------------------------------------------
  if (mode === 'reject') {
    if (!isValidRejectReason(rejectReason)) {
      return NextResponse.json(
        { error: 'Missing or invalid reject_reason.', code: 'bad_input' },
        { status: 400 },
      );
    }

    const { error: rejectLogError } = await admin.from('trial_pass_checkins').insert({
      trial_pass_id: pass.id,
      event_id: eventId,
      result: 'rejected',
      reject_reason: rejectReason,
      checked_in_by: staffUserId,
      door_device_id: device?.id || null,
      notes: rejectNote || null,
    });
    if (rejectLogError) {
      console.error('[door.trial-pass.scan.reject-log]', rejectLogError);
    }

    return NextResponse.json({
      ok: false,
      mode: 'reject',
      result: 'rejected',
      reject_reason: rejectReason,
      reason: rejectReasonLabel(rejectReason),
    });
  }

  // --------------------------------------------------------------------------
  // MODE: checkin — the full existing flow
  //
  // Every scan attempt (allowed or denied) is written down so Adam can see
  // that the trial window is too short, or that people keep turning up on
  // nights the pass does not cover.
  // --------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // ACTIVATION: first `allowed` check-in starts the 30-day clock.
  //
  // The 30-day membership window does not begin at signup — it begins now,
  // the first time the guest physically walks in the door. We set:
  //   activated_at = now
  //   expires_at   = now + 30 days
  //
  // Concurrency: the .is('activated_at', null) filter makes this a
  // conditional update. If a second scanner (or a double-tap on the kiosk)
  // races us, only one write wins; the other is a no-op and the guest keeps
  // the original activation timestamp. Never resets the clock.
  //
  // We use the app-server's `now` for both timestamps so `expires_at` is
  // always exactly TRIAL_WINDOW_DAYS after `activated_at`, no drift from
  // Postgres's clock.
  //
  // If the update returns a row, use it as `pass` for the rest of the
  // response so the guest screen shows the freshly-set expiry, not the
  // stale null it was born with.
  if (decision.allowed && !pass.activated_at) {
    const activatedAt = new Date();
    const expiresAt = new Date(activatedAt.getTime() + TRIAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const { data: activated, error: activateError } = await admin
      .from('trial_passes')
      .update({
        activated_at: activatedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .eq('id', pass.id)
      .is('activated_at', null)
      .select('id, full_name, email, status, issued_at, expires_at, extended_until, applied_at, converted_at, activated_at, signup_expires_at, profile_photo_path')
      .maybeSingle();
    if (activateError) {
      console.error('[door.trial-pass.scan.activate]', activateError);
    } else if (activated) {
      pass = activated;
    }
  }

  const expiry = effectiveExpiry(pass);

  // Fire the first-visit application-invite email, exactly once per pass, when
  // the door decision was 'allowed'. The invite is the highest-conversion
  // email in the trial funnel — the guest just walked into the room and had a
  // real experience — so we send it now rather than waiting for the day-6
  // reminder to catch them cold.
  //
  // Guardrails, in order:
  //   1. Only on decision.allowed (denials never trigger a follow-up).
  //   2. Skip if the guest already applied or converted — they don't need to
  //      be invited to apply to something they already applied to.
  //   3. Skip if we already tried to send this kind for this pass, resolved by
  //      the unique index (trial_pass_id, kind, sequence) on trial_pass_emails.
  //      The claim is inserted BEFORE Resend is called, so a retried route or
  //      a double-scan can never mail the same person twice.
  //   4. Missing email is not an error — pre-2026 pass rows might not have one.
  //   5. Resend failures are swallowed: the door decision has already been
  //      logged, and blocking the response on an email provider outage would
  //      make the check-in slower than it has any reason to be. On failure the
  //      claim is released so the next allowed scan (if any) can retry.
  if (
    decision.allowed &&
    pass.email &&
    !pass.applied_at &&
    !pass.converted_at &&
    (!logError || logError.code === '23505')
  ) {
    const { error: claimError } = await admin.from('trial_pass_emails').insert({
      trial_pass_id: pass.id,
      kind: 'application_invite',
      sequence: 0,
    });

    if (!claimError) {
      // Not awaited: the door needs its allow/deny back inside a couple hundred
      // milliseconds, and Resend can take longer than that under load.
      (async () => {
        try {
          const siteUrl = resolveSiteUrl(request);
          const result = await sendTrialPassApplicationInvite({
            email: pass.email,
            fullName: pass.full_name,
            applyUrl: `${siteUrl}/members`,
            passUrl: `${siteUrl}/pass`,
            daysLeft: daysRemaining(pass),
            expiresLabel: expiry ? formatPassDate(expiry) : '',
          });
          await admin
            .from('trial_pass_emails')
            .update({ sent_at: new Date().toISOString(), provider_id: result?.id || null })
            .eq('trial_pass_id', pass.id)
            .eq('kind', 'application_invite')
            .eq('sequence', 0);
        } catch (err) {
          console.error('[door.trial-pass.scan.invite]', pass.id, err?.message || err);
          // Release the claim so a later allowed scan (rare but possible) retries.
          await admin
            .from('trial_pass_emails')
            .delete()
            .eq('trial_pass_id', pass.id)
            .eq('kind', 'application_invite')
            .eq('sequence', 0)
            .is('sent_at', null);
        }
      })();
    } else if (claimError.code !== '23505') {
      // 23505 is the idempotency guard doing its job — not an error. Any other
      // code is a real problem worth surfacing to logs but not to the door.
      console.error('[door.trial-pass.scan.invite.claim]', pass.id, claimError);
    }
  }

  return NextResponse.json({
    ok: decision.allowed,
    mode: 'checkin',
    result: decision.result,
    reason: decision.reason,
    staffAction: decision.staffAction || null,
    guest: {
      firstName: String(pass.full_name || '').split(' ')[0] || null,
      statusLabel: passStatusLabel(pass),
      expiresLabel: expiry ? formatPassDate(expiry) : null,
      daysLeft: daysRemaining(pass),
    },
    event: event ? { id: event.id, title: event.title, date: event.event_date } : null,
  });
}

function rejectReasonLabel(reason) {
  switch (reason) {
    case REJECT_REASONS.PHOTO_MISMATCH: return 'Photo mismatch';
    case REJECT_REASONS.NO_PHOTO_ON_FILE: return 'No photo on file';
    case REJECT_REASONS.ID_MISMATCH: return 'ID mismatch';
    case REJECT_REASONS.MANUAL: return 'Manual rejection';
    default: return 'Rejected';
  }
}

import { NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { resolveSiteUrl } from '@/lib/site-url';
import { validateTrialPassIntake } from '@/lib/trial-pass';
import { checkVerification, isTwilioVerifyConfigured } from '@/lib/twilio-verify';
import { issueTrialPass, TRIAL_PASS_SOURCE_SELF_SERVE } from '@/lib/trial-pass-create';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/trial-pass/verify/check
// Body: { fullName, phone, email, code }
// Auth: the code itself.
//
// Public step 2. The guest has entered the 6-digit code Twilio texted them;
// this route confirms with Twilio, and only on approved calls
// issueTrialPass() to mint (or re-issue) the pass.
//
// The full 3 fields are re-sent from the client because verify/start didn't
// persist them. Re-validating here means:
//   a) a caller who fiddles with the payload between start and check gets
//      the same rejection as at start, and
//   b) the identity we hand to issueTrialPass() is the one we just verified,
//      not one from a cookie or session that never existed.
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const { valid, error, field, data } = validateTrialPassIntake(body);
  if (!valid) {
    return NextResponse.json({ error, field }, { status: 400 });
  }

  const codeRaw = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!/^\d{4,10}$/.test(codeRaw)) {
    return NextResponse.json({ error: 'Enter the 6-digit code we texted you.', field: 'code' }, { status: 400 });
  }

  if (!isTwilioVerifyConfigured()) {
    console.error('[trial-pass.verify.check] TWILIO_* env not set');
    return NextResponse.json(
      { error: 'Verification is temporarily unavailable — please see the front desk.' },
      { status: 503 },
    );
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Passes are temporarily unavailable — please see the front desk.' },
      { status: 503 },
    );
  }

  const check = await checkVerification({ phone: data.phone, code: codeRaw });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status || 502 });
  }
  if (!check.approved) {
    // Wrong code, or the code has already expired (Twilio Verify codes are
    // 10 minutes by default). Same message either way — leaking "your code
    // just expired" vs "wrong code" would let a farmer probe for TTL.
    return NextResponse.json(
      { error: 'That code is not right — check your text and try again.', field: 'code' },
      { status: 400 },
    );
  }

  const issued = await issueTrialPass({
    data,
    siteUrl: resolveSiteUrl(request),
    signupSource: TRIAL_PASS_SOURCE_SELF_SERVE,
    phoneVerified: true,
    createdBy: null,
  });
  if (!issued.ok) {
    return NextResponse.json({ error: issued.error, field: issued.field }, { status: issued.status || 500 });
  }

  return NextResponse.json({
    ok: true,
    existing: issued.existing,
    token: issued.token,
    passUrl: issued.passUrl,
    fullName: issued.pass.full_name,
    expiresAt: issued.pass.expires_at,
    expiresLabel: issued.expiresLabel,
    emailed: issued.emailed,
  });
}

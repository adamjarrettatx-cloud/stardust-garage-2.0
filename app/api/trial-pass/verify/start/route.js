import { NextResponse } from 'next/server';
import { validateTrialPassIntake } from '@/lib/trial-pass';
import { isTwilioVerifyConfigured, startVerification } from '@/lib/twilio-verify';
import { findExistingPassByIdentity } from '@/lib/trial-pass-create';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/trial-pass/verify/start
// Body: { fullName, phone, email, channel? }
// Auth: none — the SMS itself is the auth.
//
// Public step 1 of the two-step intake:
//   1. Guest submits the 3-field form → this route validates and calls
//      Twilio Verify to text a 6-digit code.
//   2. Guest enters the code → /api/trial-pass/verify/check confirms with
//      Twilio and issues the pass via lib/trial-pass-create.
//
// Deliberately does NOT create the pass row. If we minted a pass here, a
// scripted farmer could POST once, ignore the SMS entirely, and still hold
// a working credential. Nothing hits public.trial_passes until Twilio
// confirms that the number the guest typed is a number the guest controls.
//
// The `channel` parameter is 'sms' (default) or 'call'. Voice fallback is
// wired straight through to Twilio's Channel=call — same code, same TTL,
// spoken to a landline or a phone with broken SMS. The form calls this
// route again with channel=call when the "text not arriving" link is
// tapped; it's cheap to allow both.
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

  const channel = body?.channel === 'call' ? 'call' : 'sms';

  if (!isTwilioVerifyConfigured()) {
    // Fail loud in prod: we do not want a misconfigured env to silently
    // fall through to "trust the caller." The guest sees a soft message;
    // the log has the specifics.
    console.error('[trial-pass.verify.start] TWILIO_* env not set');
    return NextResponse.json(
      { error: 'Verification is temporarily unavailable — please see the front desk.' },
      { status: 503 },
    );
  }

  // Best-effort pre-check: is this a returning guest? The success screen
  // will show them their existing pass on check, but we still ask Twilio
  // to send a code — verifying is cheap ($0.05) and it stops someone
  // typing a stranger's email + a stranger's phone in an attempt to steal
  // that stranger's pass. Verify first, hand back second.
  const existing = await findExistingPassByIdentity({
    email_canonical: data.email_canonical,
    phone: data.phone,
  });

  const result = await startVerification({ phone: data.phone, channel });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 502 });
  }

  return NextResponse.json({
    ok: true,
    channel,
    // The form uses this to display a "welcome back" note on the code-entry
    // screen. It is not a security signal — the caller cannot skip check
    // even when existing is true.
    existing: Boolean(existing),
  });
}

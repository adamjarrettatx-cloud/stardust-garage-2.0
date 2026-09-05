import { NextResponse } from 'next/server';
import { validateTrialPassIntake } from '@/lib/trial-pass';
import { isTwilioVerifyConfigured, startVerification } from '@/lib/twilio-verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/free-account/verify/start
// Body: { fullName, phone, email, channel? }
// Auth: none — the SMS itself is the auth.
//
// Public step 1 of free-account signup. The form collects the eventual
// profile fields here, but this route deliberately persists none of them:
// until Twilio says the caller controls the number, there is no account to
// create and no profile claim worth keeping.
//
// Keeping the verification separate from account creation also means a
// mistyped number does not leave an orphaned auth.users record behind. The
// next route repeats intake validation, confirms the code, then makes the
// auth user and free_accounts row together.
//
// The `channel` parameter is 'sms' (default) or 'call'. Voice fallback is
// passed straight through to Twilio for a guest whose text is delayed or who
// needs a landline call instead.
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
    // Do not silently create an account without a proven phone when Verify is
    // misconfigured. Guests get a useful next step while production logs keep
    // the missing-secret diagnosis out of the public response.
    console.error('[free-account.verify.start] TWILIO_* env not set');
    return NextResponse.json(
      { error: 'Verification is temporarily unavailable — please see the front desk.' },
      { status: 503 },
    );
  }

  const result = await startVerification({ phone: data.phone, channel });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 502 });
  }

  return NextResponse.json({ ok: true, status: result.status });
}

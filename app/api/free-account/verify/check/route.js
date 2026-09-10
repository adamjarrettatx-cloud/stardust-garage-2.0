import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { validateTrialPassIntake } from '@/lib/trial-pass';
import { checkVerification, isTwilioVerifyConfigured } from '@/lib/twilio-verify';
import { hashRateLimitKey, keyFromRequest, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IP_RATE_LIMIT = Object.freeze({ limit: 10, windowMs: 60 * 1000 });
const PHONE_RATE_LIMIT = Object.freeze({ limit: 5, windowMs: 60 * 60 * 1000 });
const EMAIL_RATE_LIMIT = Object.freeze({ limit: 5, windowMs: 60 * 60 * 1000 });

function limitedResponse(result) {
  return NextResponse.json(
    { error: 'Too many attempts. Please try again later.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } },
  );
}

// POST /api/free-account/verify/check
// Body: { fullName, phone, email, password, code }
// Auth: the code itself.
//
// Public step 2 of free-account signup. A successful Twilio check proves the
// visitor controls the phone in the submitted profile, so only then do we
// create a new Supabase identity and its free_accounts row. Existing accounts
// must sign in rather than being reconciled by this unauthenticated path.
//
// The three intake fields are deliberately sent again rather than stored in a
// cookie between steps. This makes the identity being written here the exact
// identity Twilio just approved, and gives payload changes the same validation
// response as verify/start.
//
// Password signup is the only path through this endpoint. Google OAuth users
// already have an authenticated Supabase session and finish verification at
// /api/free-account/complete-profile instead.
export async function POST(request) {
  const ipLimit = rateLimit({
    key: keyFromRequest(request, 'free-account-verify-check'),
    ...IP_RATE_LIMIT,
  });
  if (!ipLimit.ok) return limitedResponse(ipLimit);

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

  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!/^\d{4,10}$/.test(code)) {
    return NextResponse.json({ error: 'Enter the 6-digit code we texted you.', field: 'code' }, { status: 400 });
  }

  const password = typeof body?.password === 'string' ? body.password : '';
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.', field: 'password' }, { status: 400 });
  }

  // This in-memory limiter is intentionally only a per-instance guardrail.
  // Move these buckets to Redis/Upstash before relying on them across multiple
  // serverless instances.
  const phoneLimit = rateLimit({
    key: `free-account-verify-check:phone:${hashRateLimitKey(data.phone)}`,
    ...PHONE_RATE_LIMIT,
  });
  if (!phoneLimit.ok) return limitedResponse(phoneLimit);
  const emailLimit = rateLimit({
    key: `free-account-verify-check:email:${hashRateLimitKey(data.email_canonical || data.email)}`,
    ...EMAIL_RATE_LIMIT,
  });
  if (!emailLimit.ok) return limitedResponse(emailLimit);

  if (!isTwilioVerifyConfigured()) {
    console.error('[free-account.verify.check] TWILIO_* env not set');
    return NextResponse.json(
      { error: 'Verification is temporarily unavailable — please see the front desk.' },
      { status: 503 },
    );
  }
  if (!isSupabaseConfigured()) {
    console.error('[free-account.verify.check] SUPABASE_* env not set');
    return NextResponse.json(
      { error: 'Accounts are temporarily unavailable — please see the front desk.' },
      { status: 503 },
    );
  }

  const check = await checkVerification({ phone: data.phone, code });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status || 502 });
  }
  if (!check.approved) {
    // A completed but unapproved Verify request is a wrong, expired, or
    // already-used code. It must not be allowed to create an account.
    return NextResponse.json(
      { error: 'That code is not right — check your text and try again.', field: 'code' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: existingFreeAccount, error: existingFreeAccountError } = await admin
    .from('free_accounts')
    .select('user_id')
    .eq('email', data.email_canonical || data.email)
    .maybeSingle();
  if (existingFreeAccountError) {
    console.error('[free-account.verify.check.find-free-account]', existingFreeAccountError);
    return NextResponse.json({ error: 'Could not create account.' }, { status: 500 });
  }
  if (existingFreeAccount) {
    // Keep a successful verification indistinguishable from a new signup.
    // This route must never act as an account-email oracle.
    return NextResponse.json({ ok: true });
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: data.email,
    password,
    email_confirm: true,
    phone: data.phone,
    phone_confirm: true,
    user_metadata: { full_name: data.full_name },
  });

  let userId = created?.user?.id || null;
  if (createError) {
    const existingUser = createError.code === 'user_already_exists'
      || createError.message?.toLowerCase().includes('already registered');
    if (existingUser) {
      // A race with another signup (or an existing auth-only identity) gets
      // the same response as a newly created free account.
      return NextResponse.json({ ok: true });
    }
    console.error('[free-account.verify.check.create-user]', createError);
    return NextResponse.json({ error: 'Could not create account.' }, { status: 500 });
  }

  if (!userId) {
    console.error('[free-account.verify.check.create-user] missing user id');
    return NextResponse.json({ error: 'Could not create account.' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { error: profileError } = await admin.from('free_accounts').upsert({
    user_id: userId,
    full_name: data.full_name,
    phone: data.phone,
    email: data.email_canonical || data.email,
    phone_verified_at: now,
    updated_at: now,
  }, { onConflict: 'user_id' });
  if (profileError) {
    console.error('[free-account.verify.check.profile]', profileError);
    return NextResponse.json({ error: 'Could not save profile.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

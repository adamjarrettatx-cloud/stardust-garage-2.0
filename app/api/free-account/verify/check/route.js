import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { validateTrialPassIntake } from '@/lib/trial-pass';
import { checkVerification, isTwilioVerifyConfigured } from '@/lib/twilio-verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/free-account/verify/check
// Body: { fullName, phone, email, password, code }
// Auth: the code itself.
//
// Public step 2 of free-account signup. A successful Twilio check proves the
// visitor controls the phone in the submitted profile, so only then do we
// create (or reconnect) the Supabase identity and its free_accounts row.
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
    if (!existingUser) {
      console.error('[free-account.verify.check.create-user]', createError);
      return NextResponse.json({ error: 'Could not create account.' }, { status: 500 });
    }

    const { data: users, error: listUsersError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listUsersError) {
      console.error('[free-account.verify.check.find-user]', listUsersError);
      return NextResponse.json({ error: 'Could not create account.' }, { status: 500 });
    }
    userId = users?.users?.find(
      (user) => user.email?.toLowerCase() === data.email_canonical,
    )?.id || null;
    if (!userId) {
      console.error('[free-account.verify.check.find-user] existing user not found', data.email_canonical);
      return NextResponse.json({ error: 'Could not create account.' }, { status: 500 });
    }
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

  return NextResponse.json({ ok: true, userId });
}

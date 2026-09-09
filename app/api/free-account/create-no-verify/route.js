import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { validateTrialPassIntake } from '@/lib/trial-pass';
import { sendGuestAccountWelcomeOnce } from '@/lib/free-account/send-welcome';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/free-account/create-no-verify
// Body: { fullName, email, password, phone }
//
// Ticket-checkout Stardust-account signup (password path). Mirrors
// /api/free-account/verify/check EXACTLY — same validation, same "already
// registered" reconnect, same free_accounts row — with two intentional
// differences from the trial-pass flow:
//
//   1. There is NO Twilio verification step. The buyer proved they own the
//      email address by clicking through Stripe Checkout confirmations; the
//      phone is captured for door contact but NOT verified in this flow.
//      phone_confirm is passed as false and free_accounts.phone_verified_at
//      is left null so the trial-pass code path can tell the two populations
//      apart if it ever needs to.
//   2. This is the ONLY signup step. The trial-pass flow uses verify/start +
//      verify/check as a two-request handshake; here the client submits once
//      and, on success, immediately calls supabase.auth.signInWithPassword to
//      establish a browser session. Returning { ok: true, userId } is the
//      contract that AccountGate depends on.
//
// The Twilio helpers and the /api/free-account/verify/* + /complete-profile
// routes are DELIBERATELY untouched — they still power the trial pass, which
// remains phone-verified for door TABC records. Do not consolidate the two.
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

  const password = typeof body?.password === 'string' ? body.password : '';
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.', field: 'password' }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    console.error('[free-account.create-no-verify] SUPABASE_* env not set');
    return NextResponse.json(
      { error: 'Accounts are temporarily unavailable — please see the front desk.' },
      { status: 503 },
    );
  }

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: data.email,
    password,
    email_confirm: true,
    phone: data.phone,
    phone_confirm: false, // captured, not verified — this route intentionally skips Twilio
    user_metadata: { full_name: data.full_name },
  });

  let userId = created?.user?.id || null;
  if (createError) {
    const existingUser = createError.code === 'user_already_exists'
      || createError.message?.toLowerCase().includes('already registered');
    if (!existingUser) {
      console.error('[free-account.create-no-verify.create-user]', createError);
      return NextResponse.json({ error: 'Could not create account.' }, { status: 500 });
    }
    // Match verify/check's "reconnect" branch: signal 409 so the client can
    // flip to the Sign In tab with the email prefilled. Trial-pass returns
    // 200 with the existing userId (its client silently continues), but here
    // an existing account with an unknown password isn't recoverable from the
    // signup form — the buyer needs to sign in.
    return NextResponse.json(
      { error: 'That email is already registered — sign in instead.', field: 'email', code: 'already_registered' },
      { status: 409 },
    );
  }

  if (!userId) {
    console.error('[free-account.create-no-verify.create-user] missing user id');
    return NextResponse.json({ error: 'Could not create account.' }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { error: profileError } = await admin.from('free_accounts').upsert({
    user_id: userId,
    full_name: data.full_name,
    phone: data.phone,
    email: data.email_canonical || data.email,
    phone_verified_at: null, // unverified in the ticket-checkout flow
    updated_at: now,
  }, { onConflict: 'user_id' });
  if (profileError) {
    console.error('[free-account.create-no-verify.profile]', profileError);
    return NextResponse.json({ error: 'Could not save profile.' }, { status: 500 });
  }

  // Guest-account welcome email. Idempotent per user_id — safe even though
  // this route can be retried by the client, and safe against the shared
  // helper being called from the other three account-creation routes for
  // the same identity. Send failure is deliberately non-fatal: the account
  // exists and the browser is about to sign in, so we log and continue.
  await sendGuestAccountWelcomeOnce({
    admin,
    userId,
    email: data.email_canonical || data.email,
    fullName: data.full_name,
  });

  return NextResponse.json({ ok: true, userId });
}

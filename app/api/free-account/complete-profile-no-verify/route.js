import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendGuestAccountWelcomeOnce } from '@/lib/free-account/send-welcome';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/free-account/complete-profile-no-verify
// Body: { fullName, phone }
// Auth: a Supabase bearer session (Google OAuth already signed the visitor in).
//
// Ticket-checkout Stardust-account completion (Google path). Mirrors
// /api/free-account/complete-profile except the Twilio checkVerification call
// is intentionally omitted — phone is captured but NOT verified. See
// /api/free-account/create-no-verify for the rationale; keep this in lockstep
// with that route rather than with the trial-pass complete-profile.
//
// SECURITY: the writeback identifies the user from the bearer token via
// Supabase Auth, NEVER from a client-supplied id. free_accounts has RLS; the
// service-role admin client below performs the upsert only after the user
// is resolved from the token.
export async function POST(request) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: { headers: { Authorization: request.headers.get('authorization') || '' } },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim().replace(/\s+/g, ' ') : '';
  if (!fullName || fullName.length > 120) {
    return NextResponse.json({ error: 'Enter your full legal name.', field: 'fullName' }, { status: 400 });
  }

  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  // Match validateTrialPassIntake's phone rule (10-15 digits) instead of
  // requiring strict E.164 — this endpoint is called from a plain input, not
  // a formatted picker, so we accept the same lenient shape trial-pass does.
  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.length < 10 || phoneDigits.length > 15) {
    return NextResponse.json(
      { error: 'Enter a valid mobile number (at least 10 digits).', field: 'phone' },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const admin = createAdminClient();
  const { error: profileError } = await admin.from('free_accounts').upsert({
    user_id: user.id,
    full_name: fullName,
    phone,
    email: user.email,
    phone_verified_at: null, // unverified in the ticket-checkout flow
    updated_at: now,
  }, { onConflict: 'user_id' });
  if (profileError) {
    console.error('[free-account.complete-profile-no-verify.profile]', profileError);
    return NextResponse.json({ error: 'Could not save profile.' }, { status: 500 });
  }

  // Guest-account welcome email. Same idempotent helper as the other three
  // account-creation routes — first successful completion for this OAuth
  // identity wins the send; every subsequent completion is suppressed.
  await sendGuestAccountWelcomeOnce({
    admin,
    userId: user.id,
    email: user.email,
    fullName,
  });

  return NextResponse.json({ ok: true });
}

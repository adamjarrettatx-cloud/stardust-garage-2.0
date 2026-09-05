import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkVerification, isTwilioVerifyConfigured } from '@/lib/twilio-verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/free-account/complete-profile
// Body: { fullName, phone, code }
// Auth: a Supabase bearer session.
//
// Google OAuth and any future authenticated signup provider have already made
// the auth.users identity before the visitor reaches this step. This route
// therefore only proves control of the claimed phone, then stores the profile
// against the identity verified from the bearer token — never an id supplied
// by the client.
//
// The write uses the service role because free_accounts has RLS. The anon
// client above is intentionally limited to reading Auth, so a forged request
// cannot choose another user's id or use this endpoint as a profile-write
// backdoor.
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
  if (!/^\+[1-9]\d{9,14}$/.test(phone)) {
    return NextResponse.json(
      { error: 'Enter a valid mobile number in international format.', field: 'phone' },
      { status: 400 },
    );
  }

  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!/^\d{4,10}$/.test(code)) {
    return NextResponse.json({ error: 'Enter the 6-digit code we texted you.', field: 'code' }, { status: 400 });
  }

  if (!isTwilioVerifyConfigured()) {
    console.error('[free-account.complete-profile] TWILIO_* env not set');
    return NextResponse.json(
      { error: 'Verification is temporarily unavailable — please see the front desk.' },
      { status: 503 },
    );
  }

  const check = await checkVerification({ phone, code });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status || 502 });
  }
  if (!check.approved) {
    return NextResponse.json(
      { error: 'That code is not right — check your text and try again.', field: 'code' },
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
    phone_verified_at: now,
    updated_at: now,
  }, { onConflict: 'user_id' });
  if (profileError) {
    console.error('[free-account.complete-profile.profile]', profileError);
    return NextResponse.json({ error: 'Could not save profile.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

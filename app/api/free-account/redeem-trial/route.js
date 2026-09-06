import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveSiteUrl } from '@/lib/site-url';
import { validateTrialPassIntake } from '@/lib/trial-pass';
import { issueTrialPass, TRIAL_PASS_SOURCE_SELF_SERVE } from '@/lib/trial-pass-create';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/free-account/redeem-trial
// Body: {}
// Auth: a Supabase bearer session.
//
// Redeeming a trial is deliberately a benefit of a completed free account,
// not another public intake form. The authenticated user id selects one
// server-side free_accounts row, whose phone was already approved by Twilio;
// the caller cannot replace its name, email, or phone in this request.
//
// issueTrialPass() remains the single place that mints and deduplicates passes.
// Supplying phoneVerified here preserves the verification proof from profile
// completion without spending a second SMS code or creating a parallel pass
// issuance path that could drift from the public trial form.
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

  const admin = createAdminClient();
  const { data: freeAccount, error: accountError } = await admin
    .from('free_accounts')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (accountError && accountError.code !== 'PGRST116') {
    console.error('[free-account.redeem-trial.profile]', accountError);
    return NextResponse.json({ error: 'Could not load profile.' }, { status: 500 });
  }
  if (!freeAccount) {
    return NextResponse.json(
      { error: 'Complete your profile before redeeming a trial pass.' },
      { status: 400 },
    );
  }

  const data = validateTrialPassIntake({
    fullName: freeAccount.full_name,
    phone: freeAccount.phone,
    email: freeAccount.email,
  });
  if (!data.valid) {
    return NextResponse.json({ error: data.error, field: data.field }, { status: 400 });
  }

  const issued = await issueTrialPass({
    data: data.data,
    siteUrl: resolveSiteUrl(request),
    signupSource: TRIAL_PASS_SOURCE_SELF_SERVE,
    phoneVerified: true,
  });
  if (!issued.ok) {
    return NextResponse.json({ error: issued.error, field: issued.field }, { status: issued.status || 500 });
  }

  // Stamp the trial pass with this auth user's id so the mobile app can
  // detect trial membership via a direct user_id lookup on trial_passes
  // (no email/phone joining required). Non-critical — the pass is already
  // minted — but log if it fails so we can catch drift.
  if (issued.pass?.id) {
    const { error: stampError } = await admin
      .from('trial_passes')
      .update({ user_id: user.id })
      .eq('id', issued.pass.id);
    if (stampError) {
      console.error('[free-account.redeem-trial.stamp]', stampError);
    }
  }

  return NextResponse.json({
    ok: true,
    pass: issued.pass,
    passUrl: issued.passUrl,
    token: issued.token,
    existing: issued.existing,
    emailed: issued.emailed,
  });
}

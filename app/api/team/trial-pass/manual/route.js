import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { resolveSiteUrl } from '@/lib/site-url';
import { validateTrialPassIntake } from '@/lib/trial-pass';
import { issueTrialPass, TRIAL_PASS_SOURCE_MANUAL } from '@/lib/trial-pass-create';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/team/trial-pass/manual
// Body: { fullName, phone, email }
// Auth: any signed-in team member (team_members.role in team/admin).
//
// The escape hatch. Guest's phone is dead, or foreign, or they cannot
// receive SMS for any of a dozen boring reasons. Front-desk staff types
// the three fields, this route mints the pass with no verification,
// records who did it and stamps signup_source='front_desk_manual' on the
// row so the admin trial list can distinguish vouched-for-by-staff from
// SMS-verified.
//
// Uniqueness rules still apply — a manual signup for a phone that is
// already in the table returns the existing pass with a rotated token,
// same as the self-serve path. So this cannot be used to farm trials
// either: same number = same pass, just a different way of getting there.
export async function POST(request) {
  const { user, unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  const issued = await issueTrialPass({
    data,
    siteUrl: resolveSiteUrl(request),
    signupSource: TRIAL_PASS_SOURCE_MANUAL,
    phoneVerified: false,
    createdBy: user.id,
  });
  if (!issued.ok) {
    return NextResponse.json({ error: issued.error, field: issued.field }, { status: issued.status || 500 });
  }

  // Staff view sees the pass URL directly so they can open it on the
  // guest's phone or read the code out for the guest to type. Email still
  // goes out from issueTrialPass, so the guest gets a durable record.
  return NextResponse.json({
    ok: true,
    existing: issued.existing,
    passUrl: issued.passUrl,
    fullName: issued.pass.full_name,
    email: issued.pass.email,
    phone: issued.pass.phone,
    expiresAt: issued.pass.expires_at,
    expiresLabel: issued.expiresLabel,
    emailed: issued.emailed,
  });
}

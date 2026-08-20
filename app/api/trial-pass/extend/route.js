import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { requireTeam } from '@/lib/auth-helpers';
import {
  TRIAL_EXTENSION_DAYS,
  TRIAL_EXTENSION_PRICE_USD,
  addDays,
  effectiveExpiry,
  formatPassDate,
  hashPassToken,
  isWellFormedPassToken,
} from '@/lib/trial-pass';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/trial-pass/extend
// Body: { token }
// Auth: team session ONLY.
//
// The $40 save. A guest turns up on a pass that ran out, they have already
// bought a ticket, and staff would rather take their money than send them home.
// This adds TRIAL_EXTENSION_DAYS to the pass and flips it back to usable.
//
// Deliberately NOT reachable by a door device token, unlike the scan route.
// Scanning is a read; granting extra access is a decision with $40 attached to
// it, and it should belong to a named staff member in a logged-in session so
// the extended_by column means something when Adam reconciles takings.
//
// Payment itself is out of scope here on purpose: it is collected on the
// existing SpotOn terminal like any other door sale. Wiring this to Stripe
// would mean a guest's card details on the door phone for a $40 line item that
// already has a till. The extension is recorded; the money is recorded where
// money is recorded.
export async function POST(request) {
  const { user, unauthorized } = await requireTeam();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!isWellFormedPassToken(token)) {
    return NextResponse.json({ error: 'Scan the guest\u2019s pass first.' }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  const admin = createAdminClient();

  const { data: pass, error: passError } = await admin
    .from('trial_passes')
    .select('id, full_name, status, expires_at, extended_until, extended_at')
    .eq('qr_token_hash', hashPassToken(token))
    .maybeSingle();

  if (passError) {
    console.error('[trial-pass.extend.lookup]', passError);
    return NextResponse.json({ error: 'Could not load that pass.' }, { status: 500 });
  }
  if (!pass) {
    return NextResponse.json({ error: 'That pass was not found.' }, { status: 404 });
  }

  // One extension per pass. Otherwise the 30-day trial quietly becomes a
  // rolling $40/week membership at a discount to the real thing, which is the
  // opposite of what the trial is for.
  if (pass.extended_at) {
    return NextResponse.json(
      {
        error: `This pass was already extended on ${formatPassDate(pass.extended_at)}. Point them at membership instead.`,
      },
      { status: 409 },
    );
  }

  if (pass.status === 'converted') {
    return NextResponse.json({ error: 'This guest is already a member.' }, { status: 409 });
  }

  // Extend from whichever is later: now, or the pass's current expiry. Somebody
  // buying the extension a day early gets 7 extra days on top of what they had,
  // not 7 days total.
  const now = new Date();
  const currentExpiry = effectiveExpiry(pass);
  const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
  const extendedUntil = addDays(base, TRIAL_EXTENSION_DAYS);

  const { data: updated, error: updateError } = await admin
    .from('trial_passes')
    .update({
      extended_until: extendedUntil.toISOString(),
      extended_at: now.toISOString(),
      extended_by: user?.id || null,
      status: 'extended',
    })
    .eq('id', pass.id)
    // Guard against two attendants ringing this up at once: the second update
    // matches nothing and gets the 409 above on retry.
    .is('extended_at', null)
    .select('id, full_name, status, expires_at, extended_until')
    .maybeSingle();

  if (updateError) {
    console.error('[trial-pass.extend.update]', updateError);
    return NextResponse.json({ error: 'Could not extend that pass.' }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: 'That pass was just extended by someone else.' }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    firstName: String(updated.full_name || '').split(' ')[0] || null,
    extendedUntil: updated.extended_until,
    extendedLabel: formatPassDate(updated.extended_until),
    days: TRIAL_EXTENSION_DAYS,
    // Echoed back so the door screen quotes the price from one source instead
    // of a hard-coded "$40" that goes stale when Adam changes it.
    collectUsd: TRIAL_EXTENSION_PRICE_USD,
  });
}

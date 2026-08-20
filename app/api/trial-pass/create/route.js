import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { resolveSiteUrl } from '@/lib/site-url';
import { sendTrialPassDelivery } from '@/lib/email';
import { TRIAL_PASS_SIGNUP_SOURCE } from '@/lib/signups';
import {
  TRIAL_WINDOW_DAYS,
  addDays,
  buildPassUrl,
  formatPassDate,
  generatePassToken,
  hashPassToken,
  validateTrialPassIntake,
} from '@/lib/trial-pass';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/trial-pass/create
// Body: { fullName, phone, email }
//
// The only writer of public.trial_passes from the outside world. PUBLIC and
// unauthenticated by design — the whole point is that somebody standing in the
// venue can scan a printed code and be holding a pass fifteen seconds later,
// with no account to make first.
//
// Which is exactly why the table has no anon RLS policy: this route is the
// gate. It validates, it de-duplicates by email, it mints the token, and it
// hands back only the token belonging to the person who just typed their own
// details in. Nothing here can be used to read somebody else's pass.
//
// Returns { passUrl, token, expiresAt, existing } so the success screen can
// render the QR immediately from the response, without a second round trip and
// without the token ever being stored client-side beyond the current page.
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

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Passes are temporarily unavailable — please see the front desk.' },
      { status: 503 },
    );
  }

  const admin = createAdminClient();
  const siteUrl = resolveSiteUrl(request);

  // Already have a pass? Re-issue the SAME one rather than starting a fresh
  // 30-day clock. A guest who scans the flier again next month (or taps submit
  // twice on a bad connection) gets their existing pass mailed back to them,
  // which is what they actually want, and cannot farm themselves an unlimited
  // trial by re-submitting.
  //
  // Re-issuing rotates the token: the old QR stops working. That is deliberate
  // — the guest is on the page right now and gets the new code immediately,
  // while a screenshot someone forwarded to a friend goes dead.
  const { data: existing, error: existingError } = await admin
    .from('trial_passes')
    .select('id, full_name, email, status, issued_at, expires_at, extended_until')
    // Plain equality, not ilike: validateTrialPassIntake already lower-cased
    // the address and every row is written lower-cased, so there is no case to
    // fold — and no pattern for a `%` or `_` inside somebody's address to be
    // interpreted as a wildcard.
    .eq('email', data.email)
    .maybeSingle();

  if (existingError) {
    console.error('[trial-pass.create.lookup]', existingError);
    return NextResponse.json({ error: 'Could not create your pass — try again.' }, { status: 500 });
  }

  const rawToken = generatePassToken();
  const tokenHash = hashPassToken(rawToken);
  const passUrl = buildPassUrl(siteUrl, rawToken);

  let pass = null;

  if (existing) {
    const { data: updated, error: updateError } = await admin
      .from('trial_passes')
      .update({
        qr_token_hash: tokenHash,
        // Name and phone are refreshed: the newer typing is the better record.
        // Dates, status and reminder counters are untouched.
        full_name: data.full_name,
        phone: data.phone,
      })
      .eq('id', existing.id)
      .select('id, full_name, email, status, issued_at, expires_at, extended_until')
      .single();

    if (updateError) {
      console.error('[trial-pass.create.reissue]', updateError);
      return NextResponse.json({ error: 'Could not reissue your pass — try again.' }, { status: 500 });
    }
    pass = updated;
  } else {
    const issuedAt = new Date();
    const expiresAt = addDays(issuedAt, TRIAL_WINDOW_DAYS);

    const { data: created, error: insertError } = await admin
      .from('trial_passes')
      .insert({
        full_name: data.full_name,
        email: data.email,
        phone: data.phone,
        qr_token_hash: tokenHash,
        issued_at: issuedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        source: TRIAL_PASS_SIGNUP_SOURCE,
      })
      .select('id, full_name, email, status, issued_at, expires_at, extended_until')
      .single();

    if (insertError) {
      // 23505 = unique violation on lower(email). Two submits landing in the
      // same instant race past the lookup above; the loser is told to try
      // again, and the retry finds the winner's row and reissues from it.
      if (insertError.code === '23505') {
        return NextResponse.json(
          { error: 'Your pass is already being created — tap the button once more.' },
          { status: 409 },
        );
      }
      console.error('[trial-pass.create.insert]', insertError);
      return NextResponse.json({ error: 'Could not create your pass — try again.' }, { status: 500 });
    }
    pass = created;

    // Onto the Sign Ups list, same table as the homepage form and the door
    // kiosk, so this guest shows up in the existing admin list and Mailchimp
    // export instead of a second list nobody checks. Best effort: a guest with
    // a live pass and no newsletter row is a marketing problem, not a reason to
    // fail the request they are watching.
    const { error: signupError } = await admin.from('signups').insert({
      contact: data.email,
      contact_type: 'email',
      phone: data.phone,
      full_name: data.full_name,
      source: TRIAL_PASS_SIGNUP_SOURCE,
    });
    if (signupError) {
      console.error('[trial-pass.create.signup]', signupError);
    }
  }

  // The backup email. Awaited, but a failure does not fail the request: the
  // pass is already on screen in front of them, and the email exists for the
  // case where they close the page. The send is claimed in trial_pass_emails
  // first so the reminder cron can tell delivery apart from a nudge.
  const emailResult = await deliverPassEmail({ admin, pass, passUrl });

  return NextResponse.json({
    ok: true,
    existing: Boolean(existing),
    token: rawToken,
    passUrl,
    fullName: pass.full_name,
    expiresAt: pass.expires_at,
    expiresLabel: formatPassDate(pass.extended_until || pass.expires_at),
    emailed: emailResult.emailed,
  });
}

async function deliverPassEmail({ admin, pass, passUrl }) {
  const expiresLabel = formatPassDate(pass.extended_until || pass.expires_at);

  // upsert rather than insert: a reissued pass has already got a delivery row
  // from the first time round, and the unique index on
  // (trial_pass_id, kind, sequence) would otherwise reject the second send.
  await admin
    .from('trial_pass_emails')
    .upsert(
      { trial_pass_id: pass.id, kind: 'pass_delivery', sequence: 0 },
      { onConflict: 'trial_pass_id,kind,sequence' },
    );

  try {
    const sent = await sendTrialPassDelivery({
      email: pass.email,
      fullName: pass.full_name,
      passUrl,
      expiresLabel,
    });
    const sentAt = new Date().toISOString();
    await admin
      .from('trial_pass_emails')
      .update({ sent_at: sentAt, provider_id: sent?.id || null, error: null })
      .eq('trial_pass_id', pass.id)
      .eq('kind', 'pass_delivery')
      .eq('sequence', 0);
    await admin.from('trial_passes').update({ pass_email_sent_at: sentAt }).eq('id', pass.id);
    return { emailed: true };
  } catch (err) {
    console.error('[trial-pass.create.email]', err?.message || err);
    await admin
      .from('trial_pass_emails')
      .update({ error: String(err?.message || err).slice(0, 500) })
      .eq('trial_pass_id', pass.id)
      .eq('kind', 'pass_delivery')
      .eq('sequence', 0);
    return { emailed: false };
  }
}

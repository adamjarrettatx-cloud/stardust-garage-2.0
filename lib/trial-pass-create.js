// Shared pass-issue core, called by three routes:
//
//   POST /api/trial-pass/verify/check      — public, after SMS approved
//   POST /api/team/trial-pass/manual       — team, dead-phone override
//   POST /api/trial-pass/create            — legacy, kept for now (delegates)
//
// The route boundary and the DB writes were tangled inside the old create
// route, which meant the manual override and the verified flow would either
// duplicate the same 120 lines or subtly disagree about what "existing pass"
// means. Pulling this out fixes that: every path funnels through
// issueTrialPass() and comes out the same shape.
//
// Nothing here decides authentication or verification. The route is
// responsible for proving the caller is allowed to issue a pass; this
// function trusts what it is passed and does the DB work.

import { createAdminClient } from '@/lib/supabase/admin';
import { sendTrialPassDelivery, sendTrialPassProfileInvite } from '@/lib/email';
import {
  createTrialPassProfileLink,
  ensureTrialPassAccount,
} from '@/lib/trial-pass-account';
import {
  TRIAL_SIGNUP_WINDOW_DAYS,
  addDays,
  buildPassUrl,
  canonicalizeEmail,
  formatPassDate,
  generatePassToken,
  hashPassToken,
  isActivated,
} from '@/lib/trial-pass';
import { TRIAL_PASS_SIGNUP_SOURCE } from '@/lib/signups';
import { linkTrialMemberProfile } from '@/lib/trial-member-profile';

// The date the delivery/reissue email prints under "ACTIVATE BY" (for
// unactivated passes) or "GOOD THROUGH" (post-activation, from the template's
// perspective this is just a formatted label). Unactivated passes point at
// signup_expires_at so the guest sees the deadline that actually applies
// to them. Once activated, the 30-day expires_at (or extended_until) is what
// matters.
function passExpiryLabel(pass) {
  if (isActivated(pass)) {
    return formatPassDate(pass.extended_until || pass.expires_at);
  }
  return formatPassDate(pass.signup_expires_at);
}

// Signup-source values recorded on the trial_passes row. Kept as constants
// so the two callers (verify/check and manual) can only pick a known source.
export const TRIAL_PASS_SOURCE_SELF_SERVE = TRIAL_PASS_SIGNUP_SOURCE;   // 'trial_pass_qr'
export const TRIAL_PASS_SOURCE_MANUAL = 'front_desk_manual';

// Issue (or re-issue) a trial pass.
//
// `data`             — { full_name, phone, email, email_canonical } from validateTrialPassIntake
// `siteUrl`          — resolved absolute origin, for buildPassUrl
// `signupSource`     — one of the TRIAL_PASS_SOURCE_* constants above
// `phoneVerified`    — true only when Twilio Verify approved this phone in the same request
// `createdBy`        — auth.users.id of the team member (manual override only)
// `createAccount`    — provision/reuse an auth account and link it to the pass
//                      (front-desk issuance only; see below)
//
// Why createAccount defaults to false
// -----------------------------------
// The 25%-off-Weekend-Music entitlement is granted by
// lib/tickets/entitlement-lookup.js from a trial_passes lookup keyed on
// user_id, so an unlinked pass is worth nothing at checkout. The self-serve QR
// intake has always relied on the guest redeeming their own pass through
// /api/free-account/redeem-trial, and this PR deliberately does not change
// that path — flipping account creation on for anonymous public traffic is a
// different decision with its own abuse surface. Only the staff-gated manual
// route opts in.
//
// Returns { ok: true, pass, passUrl, token, existing, emailed, accountCreated,
// accountLinked, inviteEmailed, ... } or { ok: false, error, status, field? }
// — never throws.
export async function issueTrialPass({
  data,
  siteUrl,
  signupSource,
  phoneVerified = false,
  createdBy = null,
  createAccount = false,
} = {}) {
  if (!data?.email_canonical || !data?.phone) {
    return { ok: false, error: 'Missing identity fields.', status: 400 };
  }
  if (signupSource !== TRIAL_PASS_SOURCE_SELF_SERVE && signupSource !== TRIAL_PASS_SOURCE_MANUAL) {
    return { ok: false, error: 'Unknown signup source.', status: 400 };
  }

  const admin = createAdminClient();

  // ---------------------------------------------------------------------
  // Existing-pass lookup — canonical email OR phone.
  //
  // Same person coming back on a different Gmail dot-trick, same person
  // typing their number in with a different email address, same person
  // hitting Submit twice — all resolve to the same row and get a rotated
  // token. This is the anti-farming wall at the read side; the unique
  // indexes are the anti-farming wall at the write side.
  // ---------------------------------------------------------------------
  const { data: existing, error: lookupError } = await admin
    .from('trial_passes')
    .select('id, user_id, full_name, email, phone, status, issued_at, expires_at, extended_until, activated_at, signup_expires_at')
    .or(`email_canonical.eq.${data.email_canonical},phone.eq.${data.phone}`)
    .limit(1)
    .maybeSingle();

  if (lookupError) {
    console.error('[trial-pass.issue.lookup]', lookupError);
    return { ok: false, error: 'Could not create your pass — try again.', status: 500 };
  }

  const rawToken = generatePassToken();
  const tokenHash = hashPassToken(rawToken);
  const passUrl = buildPassUrl(siteUrl, rawToken);

  // ---------------------------------------------------------------------
  // Account provisioning — enrichment, never a gate.
  //
  // The guest is standing at the desk waiting for a QR code. If Supabase
  // Auth is down, or the email collides with something we cannot resolve,
  // the pass still gets issued and the QR still works; the response reports
  // the partial state so staff can say something true out loud.
  // ---------------------------------------------------------------------
  let account = { userId: null, created: false, reused: false, error: null };
  if (createAccount) {
    account = await ensureTrialPassAccount(admin, {
      email: data.email,
      fullName: data.full_name,
    });
    if (account.error) {
      console.error('[trial-pass.issue.account]', account.error);
    }
  }

  let pass = null;
  let accountLinked = false;

  if (existing) {
    // Reissue path. Rotate the token, refresh name/phone/email in case they
    // typed a corrected value this time (email is refreshed but canonical
    // is generated so it never changes for the same underlying identity).
    // Deliberately DO NOT reset issued_at, expires_at, or reminder counters
    // — the trial started when it started, not on the second submit.
    const patch = {
      qr_token_hash: tokenHash,
      full_name: data.full_name,
      phone: data.phone,
      email: data.email,
    };
    // Record the verification if it happened this pass, but never CLEAR an
    // earlier verification: a returning guest whose second submit came in
    // through the manual override is still a verified phone.
    if (phoneVerified) patch.phone_verified_at = new Date().toISOString();
    // Backfill only. A pass that is already linked to an account keeps that
    // link: the guest may have redeemed it themselves under a different
    // identity (Google sign-in mints a new auth user for the same human),
    // and stomping user_id here would silently move their entitlement to an
    // account they are not signed in to.
    if (account.userId && !existing.user_id) {
      patch.user_id = account.userId;
    }

    const { data: updated, error: updateError } = await admin
      .from('trial_passes')
      .update(patch)
      .eq('id', existing.id)
      .select('id, user_id, full_name, email, phone, status, issued_at, expires_at, extended_until, activated_at, signup_expires_at')
      .single();

    if (updateError) {
      console.error('[trial-pass.issue.reissue]', updateError);
      return { ok: false, error: 'Could not reissue your pass — try again.', status: 500 };
    }
    pass = updated;
    accountLinked = Boolean(pass.user_id);
  } else {
    // New-pass path.
    //
    // Two clocks:
    //   signup_expires_at = 60 days from now. Outer limit — if they never
    //     activate by then, the pass dies.
    //   expires_at = null. It is populated on first door check-in with
    //     activated_at + 30 days. Do not pre-populate it here; leaving it
    //     null is how effectiveExpiry() knows to show the signup window
    //     instead of a fake 30-day countdown.
    const issuedAt = new Date();
    const signupExpiresAt = addDays(issuedAt, TRIAL_SIGNUP_WINDOW_DAYS);

    const insertRow = {
      full_name: data.full_name,
      email: data.email,
      phone: data.phone,
      qr_token_hash: tokenHash,
      issued_at: issuedAt.toISOString(),
      signup_expires_at: signupExpiresAt.toISOString(),
      source: TRIAL_PASS_SIGNUP_SOURCE, // legacy `source` column, same as before
      signup_source: signupSource,
      created_by: createdBy,
    };
    // Null when account provisioning was off or failed — identical to the
    // pre-existing behaviour, so the row shape is unchanged for the
    // self-serve path.
    if (account.userId) insertRow.user_id = account.userId;
    if (phoneVerified) insertRow.phone_verified_at = issuedAt.toISOString();

    const { data: created, error: insertError } = await admin
      .from('trial_passes')
      .insert(insertRow)
      .select('id, user_id, full_name, email, phone, status, issued_at, expires_at, extended_until, activated_at, signup_expires_at')
      .single();

    if (insertError) {
      // 23505 = unique violation on email_canonical or phone. Two submits
      // racing past the lookup — the loser retries and finds the winner.
      if (insertError.code === '23505') {
        return {
          ok: false,
          error: 'Your pass is already being created — tap the button once more.',
          status: 409,
        };
      }
      console.error('[trial-pass.issue.insert]', insertError);
      return { ok: false, error: 'Could not create your pass — try again.', status: 500 };
    }
    pass = created;
    accountLinked = Boolean(pass.user_id);

    // Add to the shared signups list so this guest shows up in the existing
    // admin views and Mailchimp export. Best-effort — the pass row exists,
    // that is the thing the guest is waiting on.
    const { error: signupError } = await admin.from('signups').insert({
      contact: data.email,
      contact_type: 'email',
      phone: data.phone,
      full_name: data.full_name,
      source: signupSource,
    });
    if (signupError) {
      console.error('[trial-pass.issue.signup]', signupError);
    }
  }

  // Match-or-create the canonical guest_profiles row for this person and
  // stamp its id onto the trial_passes row. Enrichment, not critical path:
  // if profile linking fails, the pass is still valid and the guest still
  // gets their email; the analytics view just won't include them until we
  // backfill the link.
  const guestProfileId = await linkTrialMemberProfile({
    full_name: pass.full_name,
    email: pass.email,
    phone: pass.phone,
    admin,
  });
  if (guestProfileId) {
    const { error: linkError } = await admin
      .from('trial_passes')
      .update({ guest_profile_id: guestProfileId })
      .eq('id', pass.id);
    if (linkError) {
      console.error('[trial-pass.issue.link]', linkError);
    }
  }

  const emailResult = await deliverPassEmail({ admin, pass, passUrl });

  const invite = await sendProfileInvite({
    admin,
    account,
    pass,
    passUrl,
    siteUrl,
    enabled: createAccount,
  });

  return {
    ok: true,
    existing: Boolean(existing),
    pass,
    passUrl,
    token: rawToken,
    emailed: emailResult.emailed,
    expiresLabel: passExpiryLabel(pass),
    // Account state. All three are false on the untouched self-serve path.
    accountCreated: account.created,
    accountReused: account.reused,
    accountLinked,
    accountError: account.error || null,
    inviteEmailed: invite.inviteEmailed,
  };
}

// The "complete your profile" magic-link invite.
//
// Sent ONLY for accounts this request created. When the email already
// belonged to somebody — a member, staff, a past applicant — we link the pass
// to them but do not mail a one-tap sign-in link into an existing account just
// because a staff member typed that address at the front desk. That account
// owner already has their own way in, and the link would be a
// staff-triggered session grant into an account we did not provision.
//
// Every failure is swallowed and reported: the pass and its QR are already
// live by the time this runs.
async function sendProfileInvite({ admin, account, pass, passUrl, siteUrl, enabled }) {
  if (!enabled || !account?.created || !account?.userId || !pass?.email) {
    return { inviteEmailed: false };
  }
  try {
    const { url, error } = await createTrialPassProfileLink(admin, {
      email: pass.email,
      siteUrl,
    });
    if (!url) {
      console.error('[trial-pass.issue.invite-link]', error);
      return { inviteEmailed: false };
    }
    await sendTrialPassProfileInvite({
      email: pass.email,
      fullName: pass.full_name,
      profileUrl: url,
      passUrl,
      expiresLabel: passExpiryLabel(pass),
    });
    return { inviteEmailed: true };
  } catch (err) {
    console.error('[trial-pass.issue.invite]', err?.message || err);
    return { inviteEmailed: false };
  }
}

// Same shape as before — the send is claimed in trial_pass_emails first so
// the reminder cron can tell delivery apart from a nudge, and a Resend
// failure is logged onto the same row rather than dropping the pass.
async function deliverPassEmail({ admin, pass, passUrl }) {
  const expiresLabel = passExpiryLabel(pass);

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
    console.error('[trial-pass.issue.email]', err?.message || err);
    await admin
      .from('trial_pass_emails')
      .update({ error: String(err?.message || err).slice(0, 500) })
      .eq('trial_pass_id', pass.id)
      .eq('kind', 'pass_delivery')
      .eq('sequence', 0);
    return { emailed: false };
  }
}

// Convenience for callers that just want the pre-check without doing the
// full issue. Right now used only by the verify/start route so it can
// return `existing: true` in the response and skip sending a needless SMS
// (they already have a pass — we'll re-issue on check without a code).
//
// NOTE: this is a read-only hint. The actual dedupe happens inside
// issueTrialPass() where it's guarded by the unique indexes; a race
// between the pre-check and the issue is handled there.
export async function findExistingPassByIdentity({ email_canonical, phone }) {
  if (!email_canonical && !phone) return null;
  const admin = createAdminClient();
  const filters = [];
  if (email_canonical) filters.push(`email_canonical.eq.${email_canonical}`);
  if (phone) filters.push(`phone.eq.${phone}`);
  const { data, error } = await admin
    .from('trial_passes')
    .select('id, status, phone_verified_at')
    .or(filters.join(','))
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error('[trial-pass.find]', error);
    return null;
  }
  return data;
}

// Auth-account provisioning for Trial SDG Passes (self-serve /pass, front desk,
// and the account sweep cron). Originally written for staff issuance only.
//
// Why this exists
// ---------------
// A trial pass only pays for itself at checkout when it is attached to a
// signed-in account. lib/tickets/entitlement-lookup.js reads trial_passes
// filtered by `.eq('user_id', userId)`, so a row with user_id = null grants
// nothing — the guest gets the door QR but none of the up-to-25% off Weekend
// Music Experiences that the pass is supposed to carry. The self-serve QR
// intake never had that problem in practice because the guest could redeem
// the pass themselves through /api/free-account/redeem-trial; a guest who was
// handed a pass at the front desk has no idea that step exists.
//
// So the front desk needs to create the account for them. Everything in this
// module takes the service-role client as an argument and imports nothing
// server-only, exactly like lib/partner-identity.js, so it stays unit-testable
// with a fake admin client.
//
// Design rules that are load-bearing:
//
//   * Reuse before create. Staff type emails by hand and they collide with
//     real accounts — Adam's own adam@sdgatx.com among them. We never mutate,
//     re-password or re-metadata an account we did not just create.
//   * Idempotent. A double-tap on the front desk tablet must not create two
//     users or surface an error to staff; the second call finds the first
//     call's user.
//   * Never throws. Callers treat account provisioning as enrichment around a
//     pass that must be issued either way, so every failure comes back as
//     { userId: null, error } and the caller decides.

// auth.users.email is stored lowercased by GoTrue and staff type mixed case,
// so both sides of every comparison go through here.
export function normalizeAccountEmail(email) {
  const trimmed = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return trimmed || null;
}

// Lookup goes through the service-role RPC public.auth_user_by_email (see
// supabase/migrations/20261004040000_trial_pass_account_lookup.sql), not
// auth.admin.listUsers(). In production listUsers() failed with GoTrue's
// "Database error finding users" on every front-desk issuance from
// 2026-09-20 on, so not one staff-issued pass was linked. One indexed read
// also cannot silently miss a user the way a capped page scan can.
//
// Returns { id, has_password, trial_provisioned } or null. Throws on an RPC
// error so ensureTrialPassAccount can report it rather than create a
// duplicate on a failed read.
export async function findAuthUserByEmail(admin, email) {
  const target = normalizeAccountEmail(email);
  if (!target) return null;
  const { data, error } = await admin.rpc('auth_user_by_email', { p_email: target });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.id ? row : null;
}

// Marker stamped on accounts this module creates. The free-account signup
// routes read it (via auth_user_by_email.trial_provisioned) to let the guest
// set a password on the account we made for them instead of being told the
// email is already registered.
export const TRIAL_PASS_PROVISIONED_BY = 'trial_pass';

// ensureTrialPassAccount(admin, { email, fullName })
//   → { userId, created, reused, error }
//
// `created` is true only when this call minted the auth user. `reused` is true
// when an account already existed for that email — the caller uses the pair to
// tell staff "account created" apart from "linked to their existing account",
// which are different things to say out loud at the desk.
export async function ensureTrialPassAccount(admin, { email, fullName } = {}) {
  const normalized = normalizeAccountEmail(email);
  if (!admin?.auth?.admin || !normalized) {
    return { userId: null, created: false, reused: false, error: 'missing_email_or_client' };
  }

  try {
    // Look first. An existing account is never touched: it may be a member,
    // a partner, or staff, and stamping trial metadata onto it would be a
    // silent downgrade of someone else's record.
    const existing = await findAuthUserByEmail(admin, normalized);
    if (existing?.id) {
      return { userId: existing.id, created: false, reused: true, error: null };
    }

    // Same shape as app/api/free-account/create-no-verify/route.js, minus the
    // password and the phone. No password because staff never sees one and we
    // do not want a credential travelling through the front desk; the guest
    // gets in via the magic link in the invite email. No phone because the
    // manual path exists precisely for guests whose phone could not be
    // verified — claiming phone_confirm here would be a lie, and passing an
    // unverified phone risks colliding with an auth.users phone unique index.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: normalized,
      email_confirm: true,
      user_metadata: { full_name: fullName || null, provisioned_by: TRIAL_PASS_PROVISIONED_BY },
    });

    if (createError) {
      // Lost a race with a concurrent double-tap (or the email belongs to an
      // account that listUsers paged past). Look again before giving up —
      // this is what makes the function idempotent under a fast double-tap.
      const raced = await findAuthUserByEmail(admin, normalized);
      if (raced?.id) {
        return { userId: raced.id, created: false, reused: true, error: null };
      }
      return {
        userId: null,
        created: false,
        reused: false,
        error: createError.message || String(createError),
      };
    }

    const userId = created?.user?.id || null;
    if (!userId) {
      return { userId: null, created: false, reused: false, error: 'missing_user_id' };
    }
    return { userId, created: true, reused: false, error: null };
  } catch (err) {
    return { userId: null, created: false, reused: false, error: err?.message || String(err) };
  }
}

// claimTrialProvisionedAccount(admin, { email, phone, password, fullName })
//   → { claimed, userId, reason }
//
// Every Trial Pass now creates a passwordless account. When that guest later
// signs up for a free account with the same email, createUser() reports
// "already registered" and, without this, the signup form would send them to
// a sign-in tab for a password they never had.
//
// Claiming sets a password on the account WE made, and only when all hold:
//   * the account was provisioned by this module (provisioned_by marker);
//   * no password has ever been set (a guest who already used
//     forgot-password owns it the normal way);
//   * the phone on the signup matches the phone on the Trial Pass linked to
//     that account. Knowing both the email and the pass's phone is the same
//     bar /pass itself uses to reissue a pass, and the SMS-verified signup
//     route has proved the phone outright before it gets here.
// Anything else returns { claimed: false } and the caller keeps its existing
// "already registered" behaviour. Never throws.
export async function claimTrialProvisionedAccount(admin, { email, phone, password, fullName } = {}) {
  const normalized = normalizeAccountEmail(email);
  if (!admin?.auth?.admin || !normalized || !phone || !password) {
    return { claimed: false, userId: null, reason: 'missing_input' };
  }
  try {
    const existing = await findAuthUserByEmail(admin, normalized);
    if (!existing?.id) return { claimed: false, userId: null, reason: 'no_account' };
    if (!existing.trial_provisioned) return { claimed: false, userId: null, reason: 'not_trial_provisioned' };
    if (existing.has_password) return { claimed: false, userId: null, reason: 'password_already_set' };

    const { data: passes, error: passError } = await admin
      .from('trial_passes')
      .select('id')
      .eq('user_id', existing.id)
      .eq('phone', phone)
      .limit(1);
    if (passError) return { claimed: false, userId: null, reason: passError.message || 'pass_lookup_failed' };
    if (!passes?.length) return { claimed: false, userId: null, reason: 'phone_mismatch' };

    const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
      password,
      user_metadata: { full_name: fullName || null, provisioned_by: TRIAL_PASS_PROVISIONED_BY, claimed_at: new Date().toISOString() },
    });
    if (updateError) return { claimed: false, userId: null, reason: updateError.message || 'update_failed' };
    return { claimed: true, userId: existing.id, reason: null };
  } catch (err) {
    return { claimed: false, userId: null, reason: err?.message || String(err) };
  }
}

// Where the "complete your profile" magic link lands.
//
// Same reasoning as buildPartnerActivationUrl / buildPasswordResetUrl in
// lib/partner-identity.js: we mail a link to OUR host carrying the hashed_token
// and redeem it ourselves, rather than mailing Supabase's action_link, which
// points at <project>.supabase.co and only honours redirect_to values on the
// project's allow list.
//
// The landing page is /auth/callback, which already exchanges
// ?token_hash&type=magiclink server-side and then forwards to a same-origin
// ?next path. We send them to /account/tickets because that page renders
// <CompleteProfileNudge> whenever the signed-in user has no free_accounts row
// or a blank phone — i.e. exactly the state a front-desk-issued account is in —
// and it is also where their pass and any tickets live.
export const TRIAL_PASS_PROFILE_NEXT_PATH = '/account/tickets';

export function buildTrialPassProfileUrl(siteUrl, hashedToken, next = TRIAL_PASS_PROFILE_NEXT_PATH) {
  if (!siteUrl || !hashedToken) return null;
  const base = String(siteUrl).replace(/\/+$/, '');
  return `${base}/auth/callback?token_hash=${encodeURIComponent(hashedToken)}`
    + `&type=magiclink&next=${encodeURIComponent(next)}`;
}

// Mint the one-time magic link for a freshly linked trial-pass account.
// Returns { url, error } and never throws — the invite email is the least
// important thing happening at the front desk.
export async function createTrialPassProfileLink(admin, { email, siteUrl }) {
  const normalized = normalizeAccountEmail(email);
  if (!admin?.auth?.admin || !normalized || !siteUrl) {
    return { url: null, error: 'missing_email_site_or_client' };
  }
  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: normalized,
    });
    const hashedToken = data?.properties?.hashed_token;
    if (error || !hashedToken) {
      return { url: null, error: error?.message || 'no_hashed_token' };
    }
    return { url: buildTrialPassProfileUrl(siteUrl, hashedToken), error: null };
  } catch (err) {
    return { url: null, error: err?.message || String(err) };
  }
}

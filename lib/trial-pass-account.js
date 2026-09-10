// Auth-account provisioning for staff-issued Trial SDG Passes.
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

// listUsers() is paginated. The existing dedupe in
// app/api/admin/invite-partner/route.js asks for perPage: 1000 and scans one
// page, which silently stops finding people once auth.users passes 1000 rows.
// Here we page until we find a match or run out, because a miss does not fail
// loudly — it creates a duplicate account and splits the guest's history.
const PAGE_SIZE = 200;
const MAX_PAGES = 25; // 5,000 users; well past current scale, bounded on purpose

export async function findAuthUserByEmail(admin, email) {
  const target = normalizeAccountEmail(email);
  if (!target) return null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;
    const users = data?.users || [];
    const found = users.find((u) => normalizeAccountEmail(u?.email) === target);
    if (found) return found;
    if (users.length < PAGE_SIZE) return null; // last page
  }
  return null;
}

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
      user_metadata: { full_name: fullName || null },
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

import { canonicalizeEmail, generatePassToken, hashPassToken, isPassLive } from './trial-pass.js';
import { openPassToken, sealPassToken } from './trial-pass-seal.mjs';

// Account-side access to the guest's own Trial SDG Pass.
//
// Why this exists: the public /pass intake does not create or link an
// account, so most passes have user_id = null. A guest who later signs in with
// the same email saw no pass on their profile. These helpers (1) attach that
// pass to the signed-in account when the account's email is confirmed and
// matches, and (2) return the raw token so the profile can draw the QR.

const PASS_FIELDS = 'id,user_id,full_name,status,issued_at,expires_at,extended_until,activated_at,signup_expires_at,applied_at,converted_at,qr_token_hash,qr_token_sealed';

// Backfill only: never move a pass that already belongs to another account.
// A confirmed auth email proves control of the same inbox the pass link was
// sent to, which is the same proof /pass/<token> already relies on.
export async function linkTrialPassByVerifiedEmail({ admin, user }) {
  if (!user?.id || !user.email || !user.email_confirmed_at) return { linked: false };
  const emailCanonical = canonicalizeEmail(user.email);
  if (!emailCanonical) return { linked: false };
  const { data, error } = await admin
    .from('trial_passes')
    .update({ user_id: user.id })
    .eq('email_canonical', emailCanonical)
    .is('user_id', null)
    .select('id');
  if (error) {
    console.error('[account-trial-pass.link]', error.message || error);
    return { linked: false, error };
  }
  return { linked: Array.isArray(data) && data.length > 0 };
}

// Returns { pass, token } for the owner's most relevant live pass, or
// { pass: null }. Reads are always scoped to the authenticated user id.
export async function getAccountTrialPassCredential({ admin, userId, now = new Date() }) {
  if (!userId) return { pass: null };
  const { data: passes, error } = await admin
    .from('trial_passes')
    .select(PASS_FIELDS)
    .eq('user_id', userId)
    .order('issued_at', { ascending: false })
    .limit(5);
  if (error) throw new Error('Trial pass could not be loaded.');
  const pass = (passes || []).find((row) => isPassLive(row, now));
  if (!pass) return { pass: null };

  const opened = openPassToken(pass.qr_token_sealed);
  if (opened && hashPassToken(opened) === pass.qr_token_hash) return { pass, token: opened };

  // Legacy pass (issued before sealing): the raw token is unrecoverable, so
  // mint a replacement once. Dates, activation and reminders are untouched.
  // The compare-and-set on the old hash keeps two devices loading the profile
  // at the same moment from overwriting each other.
  const token = generatePassToken();
  const sealed = sealPassToken(token);
  if (!sealed) return { pass, token: null };
  const { data: updated, error: updateError } = await admin
    .from('trial_passes')
    .update({ qr_token_hash: hashPassToken(token), qr_token_sealed: sealed })
    .eq('id', pass.id)
    .eq('user_id', userId)
    .eq('qr_token_hash', pass.qr_token_hash)
    .select('id');
  if (updateError) throw new Error('Trial pass could not be loaded.');
  if (Array.isArray(updated) && updated.length > 0) return { pass, token };

  // Lost the race: another request just sealed it. Read the winner's seal.
  const { data: fresh, error: freshError } = await admin
    .from('trial_passes')
    .select('qr_token_hash,qr_token_sealed')
    .eq('id', pass.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (freshError || !fresh) return { pass, token: null };
  const winner = openPassToken(fresh.qr_token_sealed);
  return { pass, token: winner && hashPassToken(winner) === fresh.qr_token_hash ? winner : null };
}

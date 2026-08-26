// Resolving "which partner invite is this person?" from an email address.
//
// The magic-link flow never needed this: /api/admin/invite-partner creates the
// auth.users row itself, so partner_profiles.user_id was correct by
// construction. Google sign-in breaks that. Supabase only folds a Google
// identity into an existing auth.users row by verified email when automatic
// identity linking is enabled; under manual linking the same human arrives as a
// brand new user id, and the pre-created invite identity is left orphaned.
//
// So the invited email — not the auth user id — is the durable link between a
// person and their invite, and partner_profiles.user_id follows whichever
// identity actually authenticates. See 20260730_partner_google_signin.sql.
//
// Server-only in practice (every function takes the service-role client as an
// argument, exactly like auditGuestlist in lib/guestlist-helpers.js), but it
// imports nothing server-only itself so it stays unit-testable.

import { auditGuestlist } from './guestlist-helpers.js';

// partner_profiles.invited_email is stored in this shape, and Supabase hands us
// Google's verified address verbatim, so both sides go through here before
// they are compared.
export function normalizeInviteEmail(email) {
  const trimmed = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return trimmed || null;
}

// The link we actually put in the invite email, built from the hashed_token
// that admin.auth.admin.generateLink() returns alongside its own action_link.
//
// We do not mail the action_link. That URL points at Supabase's /auth/v1/verify
// with a redirect_to back to us, and GoTrue only honours a redirect_to that
// appears in the project's Redirect URL allow list — anything else silently
// lands on the project's Site URL instead. Vercel gives every branch its own
// hostname, so preview invites were being bounced to the production home page
// no matter how correctly we computed our own origin.
//
// Sending people to our host and calling verifyOtp({ token_hash }) there takes
// GoTrue's allow list out of the loop entirely: the only host in the link is
// the one that sent it. Param names match Supabase's own custom-email-template
// convention so the page reads like their docs.
export function buildPartnerActivationUrl(siteUrl, hashedToken) {
  if (!siteUrl || !hashedToken) return null;
  const base = String(siteUrl).replace(/\/+$/, '');
  return `${base}/portal/activate?token_hash=${encodeURIComponent(hashedToken)}&type=magiclink`;
}

// Same reasoning as buildPartnerActivationUrl above, applied to password
// recovery: we mail a link to OUR host and redeem the token ourselves via
// verifyOtp({ type: 'recovery', token_hash }) on /reset-password, instead of
// mailing Supabase's own action_link (which points at
// <project>.supabase.co/auth/v1/verify and only redirects back to a host on
// the project's Redirect URL allow list — surfacing a supabase.co link to the
// recipient in the meantime, which is exactly what this replaces).
export function buildPasswordResetUrl(siteUrl, hashedToken) {
  if (!siteUrl || !hashedToken) return null;
  const base = String(siteUrl).replace(/\/+$/, '');
  return `${base}/reset-password?token_hash=${encodeURIComponent(hashedToken)}&type=recovery`;
}

// The invite behind an email address, or null when there isn't one.
//
// Matching on invited_email rather than joining through contacts is deliberate:
// this runs before the caller has any partner privileges, and it must keep
// working after staff correct a typo in the contact's email. invited_email is
// frozen at invite time.
export async function findPartnerByInvitedEmail(admin, email) {
  const normalized = normalizeInviteEmail(email);
  if (!normalized) return null;

  const { data, error } = await admin
    .from('partner_profiles')
    .select('id, user_id, contact_id, full_name, photo_url, is_active, invited_email')
    .eq('invited_email', normalized)
    .maybeSingle();

  if (error) {
    console.error('[partner-identity] invited_email lookup failed', error);
    return null;
  }
  return data || null;
}

// Point a partner_profiles row at the identity that just authenticated.
//
// Returns { relinked, error }. `relinked` is false on the common path where the
// session already belongs to the profile's user_id — the row is only written
// when the id actually differs, so the ordinary magic-link sign-in does not
// churn the table or the audit log.
//
// A failure here is not cosmetic: user_id is unique, so the update fails when
// this Google account is already the login for a DIFFERENT contact's partner
// profile. That is a real conflict (one login cannot represent two partners),
// and the caller must surface it rather than hand out a session that RLS will
// resolve to the wrong contact.
export async function relinkPartnerToUser({ admin, profile, userId, userEmail, request }) {
  if (!profile || !userId) return { relinked: false, error: null };
  if (profile.user_id === userId) return { relinked: false, error: null };

  const previousUserId = profile.user_id;

  const { error } = await admin
    .from('partner_profiles')
    .update({ user_id: userId })
    .eq('id', profile.id);

  if (error) {
    console.error('[partner-identity] could not re-point partner_profiles.user_id', error);
    return { relinked: false, error };
  }

  await auditGuestlist({
    admin,
    action: 'partner_identity_relinked',
    actorId: userId,
    actorEmail: userEmail || profile.invited_email,
    request,
    details: {
      partner_profile_id: profile.id,
      contact_id: profile.contact_id,
      invited_email: profile.invited_email,
      previous_user_id: previousUserId,
      new_user_id: userId,
    },
  });

  return { relinked: true, error: null };
}

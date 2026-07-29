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

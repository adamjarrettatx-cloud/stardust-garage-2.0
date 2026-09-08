import { createProfilePhotoSignedUrl } from '@/lib/profile-photo';

// Build the "preview card" payload the door scanner shows for a Member ID
// scan. Same shape as buildBuyerPreview() and buildTrialPassPreview() so the
// unified scanner UI can render any of them with one component.
//
// Returns:
//   {
//     memberProfileId,
//     fullName, firstName, email,
//     tierLabel, isActive, subscriptionStatus,
//     hasPhoto, photoSignedUrl,
//   }
//
// Never throws \u2014 a photo-signing failure just leaves photoSignedUrl null
// so the scanner degrades gracefully (staff falls back to ID check).
export async function buildMemberIdPreview(admin, member) {
  if (!member) return null;

  const fullName = (member.full_name || '').trim() || 'Member';
  const firstName = fullName.split(/\s+/)[0] || fullName;

  let photoSignedUrl = null;
  if (member.profile_photo_path) {
    try {
      const signed = await createProfilePhotoSignedUrl(admin, member.profile_photo_path);
      photoSignedUrl = signed?.signedUrl || null;
    } catch (err) {
      console.error('[member-id-preview.signed-url]', err?.message || err);
    }
  }
  // Fall through to the legacy public photo_url column if profile_photo_path
  // is empty or signing failed \u2014 matches the resolveMemberPhotoUrl policy.
  const displayPhotoUrl = photoSignedUrl || member.photo_url || null;

  return {
    memberProfileId: member.id,
    fullName,
    firstName,
    email: member.email || null,
    tierLabel: formatTierLabel(member.subscription_plan),
    isActive: Boolean(member.is_active),
    subscriptionStatus: member.subscription_status || null,
    hasPhoto: Boolean(displayPhotoUrl),
    photoSignedUrl: displayPhotoUrl,
  };
}

function formatTierLabel(plan) {
  if (!plan) return null;
  const map = {
    founder: 'Founder',
    creative: 'Creative',
    resident: 'Resident',
    guest: 'Guest',
  };
  return map[String(plan).toLowerCase()] || String(plan);
}

// Whitelisted reject reasons for a Member ID scan. Kept separate from the
// ticket reject reasons because a member scan can also be rejected for
// "expired membership" (something that can't happen on a ticket, which
// carries its own event date).
export const MEMBER_ID_REJECT_REASONS = Object.freeze({
  PHOTO_MISMATCH: 'photo_mismatch',
  NO_PHOTO_ON_FILE: 'no_photo_on_file',
  ID_MISMATCH: 'id_mismatch',
  MEMBERSHIP_INACTIVE: 'membership_inactive',
  MANUAL: 'manual',
});

const REJECT_SET = new Set(Object.values(MEMBER_ID_REJECT_REASONS));

export function isValidMemberIdRejectReason(reason) {
  return typeof reason === 'string' && REJECT_SET.has(reason);
}

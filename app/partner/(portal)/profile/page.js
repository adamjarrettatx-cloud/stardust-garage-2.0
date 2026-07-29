import { redirect } from 'next/navigation';
import { requirePartner } from '@/lib/auth-helpers';
import { contactTypeLabel } from '@/lib/contact-helpers';
import ProfileClient from './ProfileClient';

export const revalidate = 0;

// The partner's own record. Everything shown here comes from
// public.partner_self(), which returns the partner_profiles row plus only the
// display name and relationship type from the linked contact — internal_notes
// and the rest of the CRM record stay on the staff side.
//
// The organization name and relationship type are read-only: those describe the
// business relationship, and only staff change them. The name and photo are the
// partner's own, and editable here via PATCH /api/partner/profile.
//
// Partners are not members and not team, so this uses the hardcoded /member
// dark palette rather than the --auth-* variables (those are only injected for
// the /bananas and /team scopes — see lib/authenticated-theme.js).
export default async function PartnerProfilePage() {
  // The (portal) layout already gated this; re-checked here so the page is safe
  // standing alone.
  const { user, partner, unauthorized } = await requirePartner();
  if (unauthorized) redirect('/partner/login');

  const contactTypes = (Array.isArray(partner.contact_type) ? partner.contact_type : []).map(
    contactTypeLabel
  );

  return (
    <ProfileClient
      email={user.email}
      contactTypes={contactTypes}
      profile={{
        fullName: partner.full_name || '',
        photoUrl: partner.photo_url || '',
        contactDisplayName: partner.contact_display_name || '',
        invitedAt: partner.invited_at || null,
      }}
    />
  );
}

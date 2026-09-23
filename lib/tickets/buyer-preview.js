// Look up the buyer behind a ticket for the door-scanner preview screen.
// Returns a compact object with display name + a signed URL to the buyer's
// profile photo (5-min TTL) so door staff can visually verify the person
// scanning matches the buyer on file.
//
// Rules:
//   - Anonymous / guest checkouts (no order.user_id) fall back to the buyer
//     name/email on the order and hasPhoto=false.
//   - The signed URL is minted server-side using the service-role client;
//     the private profile-photos bucket is never exposed publicly.
//   - Missing profile_photo_path => hasPhoto=false with a clear signal for
//     the UI so staff know to select the "no photo on file" reject reason.

import { createProfilePhotoSignedUrl } from '@/lib/profile-photo';

function firstName(fullName) {
  if (!fullName) return '';
  return String(fullName).trim().split(/\s+/)[0] || '';
}

// admin: service-role Supabase client
// ticket: { order_id } from tickets row (nullable)
// Returns { displayName, firstName, email, hasPhoto, photoSignedUrl }
export async function buildBuyerPreview(admin, ticket) {
  const fallback = {
    displayName: '',
    firstName: '',
    email: '',
    hasPhoto: false,
    photoSignedUrl: null,
  };

  if (!admin || !ticket?.order_id) return fallback;

  const { data: order, error: orderErr } = await admin
    .from('orders')
    .select('id, user_id, member_profile_id, buyer_email, buyer_name')
    .eq('id', ticket.order_id)
    .maybeSingle();
  if (orderErr || !order) return fallback;

  const preview = {
    ...fallback,
    displayName: order.buyer_name || '',
    firstName: firstName(order.buyer_name),
    email: order.buyer_email || '',
  };

  // Paid members may have no free_accounts row. Match the correction RPC's
  // canonical name precedence: account, member, purchase snapshot.
  if (order.member_profile_id) {
    const { data: member } = await admin.from('member_profiles').select('full_name')
      .eq('id', order.member_profile_id).maybeSingle();
    if (member?.full_name) preview.displayName = member.full_name;
  }
  if (!order.user_id) {
    preview.firstName = firstName(preview.displayName);
    return preview;
  }

  // Prefer the free_accounts photo (ticket buyers). Falls back to member
  // profile if that surface ever writes to profile_photo_path (currently
  // it writes to legacy photo_url — handled in bananas admin, not here).
  const { data: acct } = await admin
    .from('free_accounts')
    .select('full_name, email, profile_photo_path')
    .eq('user_id', order.user_id)
    .maybeSingle();

  if (acct?.full_name) preview.displayName = acct.full_name;
  else if (!order.member_profile_id) {
    const { data: member } = await admin.from('member_profiles').select('full_name')
      .eq('user_id', order.user_id).maybeSingle();
    if (member?.full_name) preview.displayName = member.full_name;
  }
  if (acct?.email) preview.email = acct.email;
  if (preview.displayName) {
    preview.firstName = firstName(preview.displayName);
  }

  if (acct?.profile_photo_path) {
    const signed = await createProfilePhotoSignedUrl(admin, acct.profile_photo_path);
    if (signed?.signedUrl) {
      preview.hasPhoto = true;
      preview.photoSignedUrl = signed.signedUrl;
    }
  }

  return preview;
}

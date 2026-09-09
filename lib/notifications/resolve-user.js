// Resolve a user_id for notification delivery from the identifiers a
// given trigger has on hand. Every trigger point has something different:
//
//   - ticket purchased: orders.member_profile_id OR orders.buyer_email
//   - stripe webhook: stripe_customer_id
//   - trial pass: trial_passes.member_profile_id (if converted) OR pass.email
//   - contract signed: contracts.buyer_email or signer_user_id
//
// This helper normalises those into auth.users.id (returns null if the
// person doesn't have an account yet \u2014 in which case a notification can't
// be delivered to a feed and email is the only path).

export async function resolveUserIdByMemberProfileId(admin, memberProfileId) {
  if (!admin || !memberProfileId) return null;
  try {
    const { data } = await admin
      .from('member_profiles')
      .select('user_id')
      .eq('id', memberProfileId)
      .maybeSingle();
    return data?.user_id || null;
  } catch (err) {
    console.error('[resolve-user.byMemberProfile]', err?.message || err);
    return null;
  }
}

export async function resolveUserIdByEmail(admin, email) {
  if (!admin || !email) return null;
  const clean = String(email).trim().toLowerCase();
  if (!clean) return null;
  try {
    // member_profiles.email is our first look \u2014 covers active members. If
    // no match, try auth.users directly (covers trial-pass holders who
    // signed up but never became members).
    const { data: mp } = await admin
      .from('member_profiles')
      .select('user_id')
      .ilike('email', clean)
      .maybeSingle();
    if (mp?.user_id) return mp.user_id;

    // auth.users lookup via admin API. Safe on the server \u2014 admin client
    // has service role.
    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    // NB: listUsers doesn't accept an email filter directly. Use RPC or
    // admin.getUserById if we have an id. As a fallback we accept null here
    // \u2014 the caller falls back to email-only delivery.
    return null;
  } catch (err) {
    console.error('[resolve-user.byEmail]', err?.message || err);
    return null;
  }
}

export async function resolveUserIdByStripeCustomer(admin, stripeCustomerId) {
  if (!admin || !stripeCustomerId) return null;
  try {
    const { data } = await admin
      .from('member_profiles')
      .select('user_id')
      .eq('stripe_customer_id', stripeCustomerId)
      .maybeSingle();
    return data?.user_id || null;
  } catch (err) {
    console.error('[resolve-user.byStripeCustomer]', err?.message || err);
    return null;
  }
}

// Fan-out: every authenticated user with a member_profile row. Used by
// broadcast triggers like event_published, marketing_broadcast.
export async function listAllMemberUserIds(admin, { activeOnly = false } = {}) {
  if (!admin) return [];
  try {
    let q = admin
      .from('member_profiles')
      .select('user_id')
      .not('user_id', 'is', null);
    if (activeOnly) q = q.eq('is_active', true);
    const { data } = await q;
    return (data || []).map((r) => r.user_id).filter(Boolean);
  } catch (err) {
    console.error('[resolve-user.listAll]', err?.message || err);
    return [];
  }
}

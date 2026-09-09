// Small resolvers that turn a trigger's identifier (member_profile_id,
// stripe_customer_id) into an auth.users.id for notification delivery.
//
// For fanning out to a whole audience, use lib/notifications/audience.js
// instead \u2014 that module knows about tiers, roles, and event visibility.
// This one is for point triggers: "the ticket-order webhook has the buyer's
// member_profile_id, give me the user_id to notify."

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

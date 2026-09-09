// Resolves what a signed-in buyer is entitled to at checkout, from the
// database. Split from ./entitlement.js so the percent math stays importable
// by the bare test runner without a Supabase client.
//
// Must be called with the SERVICE-ROLE client. `trial_passes` is admin-only
// under RLS, so a user-scoped read returns nothing and every trial buyer would
// silently be charged list price — a failure that looks like "the discount
// doesn't work" rather than an error. The hold route already holds an admin
// client for exactly this class of read.

import { isPassLive } from '../trial-pass.js';
import { ENTITLEMENT_MEMBER, ENTITLEMENT_TRIAL } from './entitlement.js';

// A paid membership outranks a trial pass. Someone who converted mid-trial
// should be charged their tier's rate, not the 25% trial rate, and their pass
// row often still sits there live until its own clock runs out.
//
// Returns null (no automatic discount) or:
//   { kind: 'member', planKey, memberProfileId }
//   { kind: 'trial',  trialPassId }
//
// `memberProfile` is optional: the hold route has already loaded that row for
// its access gates, so passing it in avoids a second identical query. Omit it
// and this will fetch one.
export async function resolveBuyerEntitlement(admin, userId, {
  memberProfile = undefined,
  now = new Date(),
} = {}) {
  if (!admin || !userId) return null;

  let member = memberProfile;
  if (member === undefined) {
    const { data } = await admin
      .from('member_profiles')
      .select('id, is_active, subscription_status, subscription_plan')
      .eq('user_id', userId)
      .maybeSingle();
    member = data || null;
  }

  if (isEntitledMember(member)) {
    return {
      kind: ENTITLEMENT_MEMBER,
      planKey: member.subscription_plan || null,
      memberProfileId: member.id || null,
    };
  }

  const { data: passes } = await admin
    .from('trial_passes')
    .select('id, status, activated_at, expires_at, extended_until, signup_expires_at')
    .eq('user_id', userId)
    .order('issued_at', { ascending: false })
    .limit(5);

  // A guest can legitimately hold more than one row over time (staff reissue,
  // a second visit months later). Any live one earns the discount.
  const live = (passes || []).find((pass) => isPassLive(pass, now));
  if (live) {
    return { kind: ENTITLEMENT_TRIAL, trialPassId: live.id };
  }

  return null;
}

// Who counts as a member for pricing.
//
// is_active is the flag the rest of the app gates on, and it is the one Stripe
// webhooks maintain. 'trialing' counts: a trial membership is an active paying
// relationship in Stripe's eyes and gets the trial rate in entitlement.js.
// 'pending' and 'past_due' do not — an unpaid account should not be buying at
// member prices.
export function isEntitledMember(member) {
  if (!member || member.is_active !== true) return false;
  const status = String(member.subscription_status || '').toLowerCase();
  return status === 'active' || status === 'trialing';
}

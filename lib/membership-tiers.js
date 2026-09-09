// Single source of truth for membership tier metadata.
//
// The internal tier KEY ('cowork', 'iykyk') is what lives in Stripe and in
// public.member_profiles.subscription_plan. It NEVER changes when marketing
// renames a tier — that's the whole reason the keys are kept separate from
// the display labels.
//
// If we ever add a new tier ('weekender' is on deck at $48/mo — see the
// TODO in app/members/apply/[plan]/page.js), add it here first, then wire
// it into STRIPE_PRICES (lib/stripe-prices.js) and MEMBERSHIP_TIER_KEYS
// (lib/notifications/audience.js). This file is dependency-free so it can
// be imported from anywhere, including unit-tested display helpers that
// deliberately avoid '@/' path aliases and network modules.

export const MEMBERSHIP_TIERS = Object.freeze({
  weekender: Object.freeze({
    key: 'weekender',
    label: 'The Weekender',
    // No per-event discount column yet — Weekender's discount is a blanket
    // 25% off Weekend Music Experiences (Fri–Sun music events), applied
    // by future logic in lib/discountPercentResolver.js. Column may be
    // added later if per-event overrides become needed.
    discountColumn: null,
  }),
  cowork: Object.freeze({
    key: 'cowork',
    label: 'The Builder',
    // Column in public.events that stores this tier's discount percent, if
    // an admin has set one on that event.
    discountColumn: 'member_discount_percent_cowork',
  }),
  iykyk: Object.freeze({
    key: 'iykyk',
    label: 'The Insider',
    discountColumn: 'member_discount_percent_iykyk',
  }),
});

// Ordered list — cheaper than Object.values(...) for consumers that need a
// stable iteration order. Ordered cheapest → most expensive, which is also
// how the pricing page and the discount callout render them.
export const MEMBERSHIP_TIER_LIST = Object.freeze([
  MEMBERSHIP_TIERS.weekender,
  MEMBERSHIP_TIERS.cowork,
  MEMBERSHIP_TIERS.iykyk,
]);

// Frozen array of just the internal tier KEYS. Used by validators
// (e.g. broadcast route, audience.js) that need to accept-or-reject a
// tier value without loading full tier metadata.
export const MEMBERSHIP_TIER_KEYS = Object.freeze(
  MEMBERSHIP_TIER_LIST.map((t) => t.key),
);

// Display label for a plan key. Falls back to the raw key so a legacy or
// unknown value still renders something rather than 'undefined'.
export function membershipTierLabel(planKey) {
  return MEMBERSHIP_TIERS[planKey]?.label || planKey || 'Members';
}

// Tier hierarchy for access gating. Higher rank = pays more = access to
// everything the lower ranks can access. If an event requires 'weekender',
// an active 'iykyk' (rank 2) satisfies that gate. If an event requires
// 'iykyk', only an 'iykyk' member (rank 2) satisfies it — a Builder (rank 1)
// does NOT get to buy an Insider-only ticket by paying $70 less.
//
// Ordering rationale: Weekender is the cheapest tier ($48) and is
// weekend-music-only, so it's the lowest access rank. Builder ($155) is
// coworking + full member access. Insider ($225) is the highest tier with
// everything the other two have plus the exclusive Insider-only events.
export const MEMBERSHIP_TIER_RANK = Object.freeze({
  weekender: 0,
  cowork: 1,
  iykyk: 2,
});

// Does this member's active tier satisfy an event's required_membership_tier?
//
// Args:
//   memberTier - member_profiles.subscription_plan of an ACTIVE member,
//     or null/undefined if the buyer isn't an active member.
//   requiredTier - events.required_membership_tier value (may be null).
//
// Returns true when:
//   - The event has no tier gate (requiredTier is null/empty), OR
//   - The member's tier ranks >= the required tier's rank.
//
// Returns false when:
//   - No memberTier (non-member trying to buy a tier-gated ticket), OR
//   - Either tier key is unknown to the registry (fail closed — safer to
//     block one legitimate buyer than to let a bad key silently open access), OR
//   - The member's rank is below the required rank.
export function memberSatisfiesTierGate(memberTier, requiredTier) {
  if (!requiredTier) return true;
  if (!memberTier) return false;
  const memberRank = MEMBERSHIP_TIER_RANK[memberTier];
  const requiredRank = MEMBERSHIP_TIER_RANK[requiredTier];
  if (memberRank == null || requiredRank == null) return false;
  return memberRank >= requiredRank;
}

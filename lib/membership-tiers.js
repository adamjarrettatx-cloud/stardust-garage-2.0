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
// stable iteration order (the "Members get X% off" callout renders tiers in
// this order, cowork first, so a change here is a UI change).
export const MEMBERSHIP_TIER_LIST = Object.freeze([
  MEMBERSHIP_TIERS.cowork,
  MEMBERSHIP_TIERS.iykyk,
]);

// Display label for a plan key. Falls back to the raw key so a legacy or
// unknown value still renders something rather than 'undefined'.
export function membershipTierLabel(planKey) {
  return MEMBERSHIP_TIERS[planKey]?.label || planKey || 'Members';
}

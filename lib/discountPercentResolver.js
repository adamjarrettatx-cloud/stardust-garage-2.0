// Pure helpers for resolving a member discount percent from an event row.
// Split out of discountCodeUtils.js so they can be unit-tested without pulling
// in the TicketTailor SDK (which uses '@/...' module aliases that node's
// bare test runner can't resolve).

export const QUALIFYING_CATEGORIES = ['workshop', 'yoga', 'party'];

// Default member discount percentage per category. 'other' is a fallback and
// doesn't trigger codes, but is kept here for getDiscountPercent's lookup.
export const CATEGORY_DISCOUNT_DEFAULTS = {
  workshop: 60,
  yoga: 40,
  party: 60,
  other: 50,
};

// Resolves the discount percent for an event: an explicit per-event override
// wins, otherwise the category default (final fallback 50).
export function getDiscountPercent(category, memberDiscountPercent) {
  if (memberDiscountPercent != null) return memberDiscountPercent;
  return CATEGORY_DISCOUNT_DEFAULTS[category] ?? 50;
}

// Resolves the discount percent for a specific (event, member plan). Precedence:
//   1) event.member_discount_percent_<plan> (per-plan override)
//   2) event.member_discount_percent (legacy shared override)
//   3) CATEGORY_DISCOUNT_DEFAULTS[event.category]
//   4) 50
// planKey is the internal Stripe plan key from member_profiles.subscription_plan
// ('cowork' for The Weekender, 'iykyk' for Experience). An unknown or missing
// plan just falls through to the legacy/category value.
export function getDiscountPercentForPlan(event, planKey) {
  const perPlan =
    planKey === 'cowork'
      ? event?.member_discount_percent_cowork
      : planKey === 'iykyk'
      ? event?.member_discount_percent_iykyk
      : null;
  if (perPlan != null) return perPlan;
  if (event?.member_discount_percent != null) return event.member_discount_percent;
  return CATEGORY_DISCOUNT_DEFAULTS[event?.category] ?? 50;
}

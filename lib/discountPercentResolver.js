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

// The Weekender ($48/mo) has no automatic member discount on this legacy
// path. The old flat 25% off Weekend Music Experiences was retired by the
// owner (2026-10-17); only an explicit per-event Weekender value applies.

// Resolves the discount percent for an event: an explicit per-event override
// wins, otherwise the category default (final fallback 50).
export function getDiscountPercent(category, memberDiscountPercent) {
  if (memberDiscountPercent != null) return memberDiscountPercent;
  return CATEGORY_DISCOUNT_DEFAULTS[category] ?? 50;
}

// Resolves the discount percent for a specific (event, member plan).
//
// Precedence:
//   1) Weekender + member_discount_percent_weekender  ->  per-event value
//   2) Weekender + anything else                     ->  0 (no discount)
//   3) event.member_discount_percent_<plan>          ->  per-plan override
//   4) event.member_discount_percent                 ->  legacy shared override
//   5) CATEGORY_DISCOUNT_DEFAULTS[event.category]    ->  category default
//   6) 50                                            ->  final fallback
//
// planKey is the internal Stripe plan key from member_profiles.subscription_plan:
//   'weekender' -> The Weekender ($48/mo)
//   'cowork'    -> The Builder   ($155/mo)
//   'iykyk'     -> The Insider   ($225/mo)
// An unknown or missing plan falls through to the legacy/category value.
export function getDiscountPercentForPlan(event, planKey) {
  // Weekender never falls through to the shared/category defaults: it gets
  // only an explicitly set per-event Weekender value, otherwise nothing.
  if (planKey === 'weekender') {
    const v = Number(event?.member_discount_percent_weekender);
    return event?.member_discount_percent_weekender != null && Number.isFinite(v) && v > 0
      ? Math.floor(v)
      : 0;
  }

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

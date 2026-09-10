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

// How a tier earns a discount on tickets. One vocabulary, so the checkout
// resolver and the admin "Member pricing" panel can never disagree about who
// gets what — the panel renders its rows straight off this registry.
//
//   NONE                -> never discounted, and no control is offered.
//   WEEKEND_MUSIC_FIXED -> a flat rate on events flagged
//                          is_weekend_music_experience, nothing elsewhere.
//                          Not per-event editable: it's the tier's identity.
//   PER_EVENT           -> nothing unless someone sets a percent on the event,
//                          capped at maxPercent.
export const TICKET_DISCOUNT_POLICY = Object.freeze({
  NONE: 'none',
  WEEKEND_MUSIC_FIXED: 'weekend_music_fixed',
  PER_EVENT: 'per_event',
});

// The flat rate for WEEKEND_MUSIC_FIXED tiers. A Trial SDG Pass earns the same
// rate on the same events (owner's rule), which is why the number lives here
// rather than inside the Weekender's entry.
export const WEEKEND_MUSIC_FIXED_PERCENT = 25;

// The Insider's ceiling. Owner's rule: "The Insider gets up to 60% off of
// tickets that we decide their discount on." Both halves matter — 60 is a hard
// cap, and "we decide" means there is no default; an event with nothing set
// discounts nothing.
export const INSIDER_MAX_DISCOUNT_PERCENT = 60;

export const MEMBERSHIP_TIERS = Object.freeze({
  weekender: Object.freeze({
    key: 'weekender',
    label: 'The Weekender',
    priceLabel: '$48/mo',
    // Weekend-music-only by design: 25% off a flagged event and nothing
    // anywhere else. There is deliberately no per-event column — this rate is
    // the tier's flagship benefit, not a per-show decision.
    discountColumn: null,
    ticketDiscount: Object.freeze({
      policy: 'weekend_music_fixed',
      percent: 25,
    }),
  }),
  cowork: Object.freeze({
    key: 'cowork',
    label: 'The Builder',
    priceLabel: '$155/mo',
    // The coworking tier gets NO ticket discount (owner, 2026-09-09). The
    // column still exists and is still read by the legacy TicketTailor code
    // generator, but first-party checkout ignores it — see ticketDiscount.
    discountColumn: 'member_discount_percent_cowork',
    ticketDiscount: Object.freeze({ policy: 'none' }),
  }),
  iykyk: Object.freeze({
    key: 'iykyk',
    label: 'The Insider',
    priceLabel: '$225/mo',
    discountColumn: 'member_discount_percent_iykyk',
    ticketDiscount: Object.freeze({
      policy: 'per_event',
      maxPercent: 60,
    }),
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

// Single source of truth for membership tier metadata.
//
// The internal tier KEY ('cowork', 'iykyk') is what lives in Stripe and in
// public.member_profiles.subscription_plan. It NEVER changes when marketing
// renames a tier — that's the whole reason the keys are kept separate from
// the display labels.
//
// If we add a new tier, add it here first, then wire
// it into STRIPE_PRICES (lib/stripe-prices.js) and MEMBERSHIP_TIER_KEYS
// (lib/notifications/audience.js). This file is dependency-free so it can
// be imported from anywhere, including unit-tested display helpers that
// deliberately avoid '@/' path aliases and network modules.

// --- Ticket discounts -----------------------------------------------------
//
// Every tier has its own per-event percent column. A NULL uses its default.
// Explicitly eligible weeknight experiences guarantee a 20% minimum for paid
// tiers, including when an older per-event value is 0. Higher discounts win.
//
// Defaults exist so the common case needs no typing: flipping an event's
// `is_weekend_music_experience` flag gives The Weekender and Trial SDG Pass
// holders their 25% automatically. is_weeknight_experience gives all paid tiers
// their advertised 20% minimum. Trial passes do not inherit paid-tier benefits.
//
// This is the single source of truth. lib/tickets/entitlement.js prices from it
// and the admin Member pricing panel renders its rows from it, so the number
// shown to whoever is configuring the event is the number the buyer is charged.
//
// These ticket discounts apply to ticket products only. Private-space rentals
// have their own, separate benefit below (PRIVATE_SPACE_DISCOUNT_PERCENT), and
// the split is enforced by product kind in lib/tickets/pricing.js.

// The standing weekend-music benefit shared by The Weekender and Trial SDG Pass.
export const WEEKEND_MUSIC_FIXED_PERCENT = 25;
export const WEEKNIGHT_MEMBER_DISCOUNT_PERCENT = 20;

// The Insider's ceiling. Owner's rule: "up to 60% off". Enforced here, in the
// admin input, and by a CHECK constraint on the column.
export const INSIDER_MAX_DISCOUNT_PERCENT = 60;

// --- Private-space rentals ------------------------------------------------
//
// Owner's rule (2026-10-09): every private space is sold to the public at its
// sticker price. Active Insider members pay 20% less. No other tier and no
// Trial SDG Pass earns a rental discount, and no per-event setting changes it,
// so the advertised Insider price is always the price an Insider is charged.
export const INSIDER_PRIVATE_SPACE_DISCOUNT_PERCENT = 20;
export const PRIVATE_SPACE_DISCOUNT_TIER_KEY = 'iykyk';

export const MEMBERSHIP_TIERS = Object.freeze({
  weekender: Object.freeze({
    key: 'weekender',
    label: 'The Weekender',
    priceLabel: '$48/mo',
    discountColumn: 'member_discount_percent_weekender',
    ticketDiscount: Object.freeze({
      // 25% off Weekend Music Experiences is the tier's flagship benefit, so
      // it is the default rather than something to remember to type.
      weekendMusicDefaultPercent: WEEKEND_MUSIC_FIXED_PERCENT,
      weeknightMinimumPercent: WEEKNIGHT_MEMBER_DISCOUNT_PERCENT,
      defaultPercent: 0,
      maxPercent: 100,
    }),
  }),
  cowork: Object.freeze({
    key: 'cowork',
    label: 'The Builder',
    priceLabel: '$155/mo',
    discountColumn: 'member_discount_percent_cowork',
    ticketDiscount: Object.freeze({
      weekendMusicDefaultPercent: 0,
      weeknightMinimumPercent: WEEKNIGHT_MEMBER_DISCOUNT_PERCENT,
      defaultPercent: 0,
      maxPercent: 100,
    }),
  }),
  iykyk: Object.freeze({
    key: 'iykyk',
    label: 'The Insider',
    priceLabel: '$225/mo',
    discountColumn: 'member_discount_percent_iykyk',
    privateSpaceDiscountPercent: INSIDER_PRIVATE_SPACE_DISCOUNT_PERCENT,
    ticketDiscount: Object.freeze({
      // Event-specific discounts may increase the weeknight benefit to 60%.
      weekendMusicDefaultPercent: 0,
      weeknightMinimumPercent: WEEKNIGHT_MEMBER_DISCOUNT_PERCENT,
      defaultPercent: 0,
      maxPercent: INSIDER_MAX_DISCOUNT_PERCENT,
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
// the lowest access rank. Builder ($155) is
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

// ---------------------------------------------------------------------------
// Trial SDG Pass
// ---------------------------------------------------------------------------
//
// Not a membership tier — it has no subscription and never appears in
// MEMBERSHIP_TIERS — but it shares the standing weekend-music benefit, not the
// paid weeknight benefit, and has its own per-event override. Modelled with the same
// shape so the resolver and the admin panel can treat it as one more row
// instead of special-casing it.
export const TRIAL_PASS_PRICING = Object.freeze({
  key: 'trial',
  label: 'Trial SDG Pass',
  priceLabel: 'Any live trial pass, no code needed',
  discountColumn: 'member_discount_percent_trial',
  ticketDiscount: Object.freeze({
    weekendMusicDefaultPercent: WEEKEND_MUSIC_FIXED_PERCENT,
    defaultPercent: 0,
    maxPercent: 100,
  }),
});

// Every row the Member pricing panel shows, in display order: the trial pass
// first (it is the cheapest way in), then the paid tiers cheapest-first.
export const MEMBER_PRICING_ROWS = Object.freeze([
  TRIAL_PASS_PRICING,
  ...MEMBERSHIP_TIER_LIST,
]);

export function memberPricingEntry(key) {
  if (key === TRIAL_PASS_PRICING.key) return TRIAL_PASS_PRICING;
  return MEMBERSHIP_TIERS[key] || null;
}

// The discount percent an entry earns on a given event.
//
// Resolve an explicit per-event value or the normal weekend/plain default,
// then enforce the paid-tier minimum for an explicitly flagged weeknight.
// Two eligible classifications never stack percentages.
//
// Note what is absent: no event category lookup, and no fallback to the legacy
// shared `member_discount_percent`. Both used to be able to price a ticket
// without anyone having chosen the number — the category table ended in a
// `?? 50` that granted half off on every unmapped category, and the shared
// column predates per-tier pricing. Since this figure is what the buyer is
// charged, nothing implicit is allowed to set it.
export function resolveTicketDiscountPercent(event, entry) {
  const policy = entry?.ticketDiscount;
  if (!policy) return 0;

  const cap = policy.maxPercent ?? 100;
  const minimum = event?.is_weeknight_experience === true
    ? policy.weeknightMinimumPercent ?? 0
    : 0;
  const stored = entry.discountColumn ? event?.[entry.discountColumn] : null;

  if (stored != null && stored !== '') {
    const n = Number(stored);
    if (Number.isFinite(n)) return Math.min(cap, Math.max(minimum, 0, Math.floor(n)));
  }

  const fallback = event?.is_weekend_music_experience
    ? policy.weekendMusicDefaultPercent
    : policy.defaultPercent;
  return Math.min(cap, Math.max(minimum, 0, Math.floor(Number(fallback) || 0)));
}

// The default an entry would earn on this event if its column were cleared.
// The admin panel shows this as the percent input's placeholder, so "blank"
// reads as a concrete number rather than an unknown.
export function defaultTicketDiscountPercent(event, entry) {
  return resolveTicketDiscountPercent({ ...event, [entry?.discountColumn]: null }, entry);
}

// Percent off a private-space rental for a pricing entry. Only The Insider
// earns one; everything else (other tiers, Trial SDG Pass, unknown keys) is 0.
export function privateSpaceDiscountPercent(entry) {
  const n = Number(entry?.privateSpaceDiscountPercent);
  return Number.isFinite(n) && n > 0 ? Math.min(100, Math.floor(n)) : 0;
}

// The Insider price for a rental's sticker price, rounded the same way the
// checkout rounds a discount (down), so the advertised figure is exact.
export function insiderPrivateSpacePriceCents(stickerCents) {
  const base = Math.max(0, Math.floor(Number(stickerCents) || 0));
  return base - Math.floor((base * INSIDER_PRIVATE_SPACE_DISCOUNT_PERCENT) / 100);
}

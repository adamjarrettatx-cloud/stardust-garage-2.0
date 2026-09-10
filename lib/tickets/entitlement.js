// Automatic ticket entitlements for first-party checkout.
//
// Historically the only way to get money off a ticket in our own checkout was
// to type a code into the widget: `ticket_discount_codes` is event-scoped and
// has no link to a user or a tier, and paid members received their benefit as
// a personal TicketTailor code emailed three days before the show. That left
// the buyer's actual standing with SDG doing no work at checkout at all.
//
// An "entitlement" is that standing: something true about the signed-in buyer
// that earns a price without them holding a code. Two kinds exist today.
//
//   member  — an active member_profiles row; the percent comes from that tier's
//             per-event column, defaulting to the tier's standing benefit.
//   trial   — a live Trial SDG Pass; 25% off Weekend Music Experiences by
//             default, overridable per event like any membership.
//
// Keeping this module pure (no Supabase import) is deliberate and mirrors why
// discountPercentResolver.js was split out of discountCodeUtils.js: the money
// math has to be unit-testable by node's bare test runner without mocking a
// database. The row lookup lives in ./entitlement-lookup.js.

import {
  memberPricingEntry,
  resolveTicketDiscountPercent,
  TRIAL_PASS_PRICING,
  WEEKEND_MUSIC_FIXED_PERCENT,
  INSIDER_MAX_DISCOUNT_PERCENT,
} from '../membership-tiers.js';

export { WEEKEND_MUSIC_FIXED_PERCENT, INSIDER_MAX_DISCOUNT_PERCENT };

// Kept as the old name for callers that imported it; the trial pass's rate is
// now a default on TRIAL_PASS_PRICING like every other membership's.
export const TRIAL_WEEKEND_MUSIC_DISCOUNT_PERCENT = WEEKEND_MUSIC_FIXED_PERCENT;

export const ENTITLEMENT_MEMBER = 'member';
export const ENTITLEMENT_TRIAL = 'trial';

// What percent off this buyer earns on this event.
//
// All of the policy lives in lib/membership-tiers.js — every membership type
// has a per-event column there, with a default for when it is unset. This
// function only picks which entry applies to the buyer.
//
// Scope note: the percent returned here applies to ticket products only.
// computeHoldSnapshot decides what it may be charged against, so a
// private-space rental in the same cart is never discounted.
export function resolveEntitlementPercent(event, entitlement) {
  if (!event || !entitlement) return 0;

  if (entitlement.kind === ENTITLEMENT_TRIAL) {
    return resolveTicketDiscountPercent(event, TRIAL_PASS_PRICING);
  }

  if (entitlement.kind === ENTITLEMENT_MEMBER) {
    // member_profiles.subscription_plan can literally be 'trial' — a trial
    // membership, distinct from a Trial SDG Pass. memberPricingEntry maps it to
    // the trial-pass row rather than letting it miss every tier.
    const entry = memberPricingEntry(entitlement.planKey);
    if (!entry) return 0;
    return resolveTicketDiscountPercent(event, entry);
  }

  return 0;
}

// Back-compat wrapper: the percent a paid tier earns on an event.
export function paidTierPercent(event, planKey) {
  const entry = memberPricingEntry(planKey);
  return entry ? resolveTicketDiscountPercent(event, entry) : 0;
}

// Clamp to a sane integer percent. A per-event override is admin-entered, so a
// typo like 250 must not turn into a negative total downstream.
export function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, Math.floor(n));
}

// Cents off the ticket subtotal for an entitlement percent. Never touches the
// booking fee — same boundary a percent code respects — and rounds down so we
// never give away a cent more than the percent earns.
export function entitlementDiscountCents(subtotalCents, percent) {
  const pct = clampPercent(percent);
  const base = Math.max(0, Math.floor(Number(subtotalCents) || 0));
  if (!pct || !base) return 0;
  return Math.floor((base * pct) / 100);
}

// Which discount the buyer actually pays under.
//
// Entitlements and typed codes DO NOT STACK — the buyer gets whichever is worth
// more. Stacking a 25% trial pass on a 50%-off promo would send a two-for-one
// night out at 37.5% of list, which is not what either discount promised on its
// own.
//
// Exception: a target_total code is an exact-price instrument (comps, $20 door
// deals, partner rates) that back-solves to a specific final total. Letting a
// bigger entitlement beat it would undershoot the price it exists to produce,
// so it wins outright.
//
// Lives here, exported, because both computeHoldSnapshot (what the buyer is
// charged) and the checkout widget (what the buyer is shown) have to reach the
// same answer. Two copies of this rule would eventually disagree, and the
// symptom would be a total that changes when you click Buy.
export function pickDiscountCents({ codeCents = 0, entitlementCents = 0, codeType = null }) {
  const code = Math.max(0, Math.floor(Number(codeCents) || 0));
  const ent = Math.max(0, Math.floor(Number(entitlementCents) || 0));

  if (codeType === 'target_total') {
    return { discountCents: code, source: code ? 'code' : null };
  }
  if (ent > code) return { discountCents: ent, source: 'entitlement' };
  return { discountCents: code, source: code ? 'code' : null };
}

// The line the buyer reads in the checkout widget, e.g.
//   "Trial pass — 25% off"
//   "The Insider — 60% off"
// Returns null when there's nothing to show, so the widget can skip the row
// rather than render an empty one.
export function entitlementLabel(entitlement, percent) {
  const pct = clampPercent(percent);
  if (!entitlement || !pct) return null;

  if (entitlement.kind === ENTITLEMENT_TRIAL) {
    return `Trial pass — ${pct}% off`;
  }
  if (entitlement.kind === ENTITLEMENT_MEMBER) {
    if (entitlement.planKey === 'trial') return `Trial — ${pct}% off`;
    const tier = memberPricingEntry(entitlement.planKey)?.label || 'Member';
    return `${tier} — ${pct}% off`;
  }
  return null;
}

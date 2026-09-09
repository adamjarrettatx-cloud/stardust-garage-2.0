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
//   member  — an active member_profiles row; percent comes from the existing
//             per-plan resolver so paid tiers keep the exact rates they
//             already had, just applied automatically instead of by email.
//   trial   — a live Trial SDG Pass; flat 25% off Weekend Music Experiences
//             and nothing else.
//
// Keeping this module pure (no Supabase import) is deliberate and mirrors why
// discountPercentResolver.js was split out of discountCodeUtils.js: the money
// math has to be unit-testable by node's bare test runner without mocking a
// database. The row lookup lives in ./entitlement-lookup.js.

import { getDiscountPercentForPlan } from '../discountPercentResolver.js';

// A trial pass earns the same flagship rate as The Weekender ($48/mo) on
// Weekend Music Experiences, and no discount on anything else. Owner's rule:
// "all TRIAL PASS accounts are immediately eligible for up to 25% off on
// Weekend Music Experiences." The "up to" is the non-weekend case returning 0,
// not a sliding scale. Changing this number is a business decision.
export const TRIAL_WEEKEND_MUSIC_DISCOUNT_PERCENT = 25;

export const ENTITLEMENT_MEMBER = 'member';
export const ENTITLEMENT_TRIAL = 'trial';

// Human-facing tier names, kept here so the checkout widget and the hold route
// can't drift on wording.
const PLAN_LABELS = {
  weekender: 'The Weekender',
  cowork: 'The Builder',
  iykyk: 'The Insider',
};

// Resolves the automatic discount percent for (event, entitlement).
//
// `entitlement` is null for a guest or free account, or
//   { kind: 'member', planKey }  |  { kind: 'trial' }
//
// Returns an integer 0-100. 0 means "no automatic discount" and callers should
// treat it as "charge list price", not as an error.
export function resolveEntitlementPercent(event, entitlement) {
  if (!entitlement || !entitlement.kind) return 0;

  if (entitlement.kind === ENTITLEMENT_TRIAL) {
    return event?.is_weekend_music_experience
      ? TRIAL_WEEKEND_MUSIC_DISCOUNT_PERCENT
      : 0;
  }

  if (entitlement.kind === ENTITLEMENT_MEMBER) {
    // member_profiles.subscription_plan can literally be 'trial' (a trial
    // membership, distinct from a Trial SDG Pass). getDiscountPercentForPlan
    // has no case for it, so it would fall through to the category default
    // and hand a trial 50-60% off. Trials get the trial rate, whichever table
    // they happen to be represented in.
    if (entitlement.planKey === 'trial') {
      return event?.is_weekend_music_experience
        ? TRIAL_WEEKEND_MUSIC_DISCOUNT_PERCENT
        : 0;
    }
    const percent = getDiscountPercentForPlan(event, entitlement.planKey);
    return clampPercent(percent);
  }

  return 0;
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
    const tier = PLAN_LABELS[entitlement.planKey] || 'Member';
    return `${tier} — ${pct}% off`;
  }
  return null;
}

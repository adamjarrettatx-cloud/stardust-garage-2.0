// Pure display helpers for the member-discount callout shown on public event
// pages. Kept free of any '@/' alias imports (and any network/secret modules)
// so it can be unit-tested directly under `node --test`, the same constraint
// the other tested lib modules follow.

import { MEMBERSHIP_TIERS } from './membership-tiers.js';
import { WEEKENDER_WEEKEND_MUSIC_DISCOUNT_PERCENT } from './discountPercentResolver.js';

// LEGACY single-discount helper. Left in place because callers elsewhere may
// still consume `{ show, percent, text }` shaped output. New callers should
// use memberDiscountCalloutRows below, which understands the per-membership
// tier columns (member_discount_percent_cowork / _iykyk) that the Ticketing
// panel actually writes to.
export function memberDiscountCallout(memberDiscountPercent) {
  const pct = coercePercent(memberDiscountPercent);
  if (pct == null) return { show: false, percent: null, text: null };
  return { show: true, percent: pct, text: `Members get ${pct}% OFF` };
}

// Re-export tier display metadata for backwards compatibility with existing
// callers of this module. New callers should import MEMBERSHIP_TIERS from
// lib/membership-tiers.js directly.
//
// The shape matches the historical `{ label, column }` contract:
//   MEMBER_TIER_DISPLAY.cowork.label   -> 'The Builder'
//   MEMBER_TIER_DISPLAY.iykyk.label    -> 'The Insider'
export const MEMBER_TIER_DISPLAY = Object.freeze({
  cowork: Object.freeze({
    label: MEMBERSHIP_TIERS.cowork.label,
    column: MEMBERSHIP_TIERS.cowork.discountColumn,
  }),
  iykyk: Object.freeze({
    label: MEMBERSHIP_TIERS.iykyk.label,
    column: MEMBERSHIP_TIERS.iykyk.discountColumn,
  }),
});

// Build the rows to render inside the gold "MEMBERS" callout on a public
// event page.
//
// Precedence:
//   1. If the event is flagged as a Weekend Music Experience, prepend a
//      Weekender row with the flat WEEKENDER_WEEKEND_MUSIC_DISCOUNT_PERCENT.
//   2. If either per-tier column is set on the event, show ONLY the tier(s)
//      that are set (Builder, Insider, or both). We don't mix legacy +
//      tiered — once an admin sets a per-tier value, that's the source of
//      truth for what memberships get a discount on this event.
//   3. Otherwise, if the legacy generic member_discount_percent is set,
//      fall back to a single "Members" row so older events keep working.
//   4. Otherwise, no callout (unless the Weekender row exists from step 1).
//
// Accepts partial event rows so the caller doesn't have to hand-pick fields.
export function memberDiscountCalloutRows(event) {
  const rows = [];

  // Weekender: shown whenever the event is a Weekend Music Experience,
  // regardless of whether Builder/Insider also have discounts here.
  if (event?.is_weekend_music_experience) {
    rows.push({
      key: 'weekender',
      label: MEMBERSHIP_TIERS.weekender.label,
      percent: WEEKENDER_WEEKEND_MUSIC_DISCOUNT_PERCENT,
    });
  }

  const cowork = coercePercent(event?.member_discount_percent_cowork);
  const iykyk  = coercePercent(event?.member_discount_percent_iykyk);

  if (cowork != null) rows.push({ key: 'cowork', label: MEMBERSHIP_TIERS.cowork.label, percent: cowork });
  if (iykyk  != null) rows.push({ key: 'iykyk',  label: MEMBERSHIP_TIERS.iykyk.label,  percent: iykyk });

  // If any tier row was added (Weekender/Builder/Insider), that's the
  // canonical list — don't also fall through to the legacy shared column.
  if (rows.length > 0) return rows;

  const legacy = coercePercent(event?.member_discount_percent);
  if (legacy != null) {
    return [{ key: 'legacy', label: 'Members', percent: legacy }];
  }

  return [];
}

// Accept a numeric or numeric-string percent in 1..100. Anything else (null,
// empty string, non-integer, 0, >100) returns null so callers can treat it
// uniformly as "not set".
function coercePercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > 100) return null;
  return n;
}

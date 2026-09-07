// Pure display helpers for the member-discount callout shown on public event
// pages. Kept free of any '@/' alias imports (and any network/secret modules)
// so it can be unit-tested directly under `node --test`, the same constraint
// the other tested lib modules follow.

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

// The two membership tiers we currently sell. Keeping the display labels here
// (not just in JSX) means the callout, unit tests, and any future emails or
// receipt copy all say the same thing.
export const MEMBER_TIER_DISPLAY = Object.freeze({
  cowork: { label: 'The Weekender', column: 'member_discount_percent_cowork' },
  iykyk:  { label: 'Experience Member', column: 'member_discount_percent_iykyk' },
});

// Build the rows to render inside the gold "MEMBERS" callout on a public
// event page.
//
// Precedence:
//   1. If either per-tier column is set on the event, show ONLY the tier(s)
//      that are set (Weekender, Experience, or both). We don't mix legacy +
//      tiered — once an admin sets a per-tier value, that's the source of
//      truth for what memberships get a discount on this event.
//   2. Otherwise, if the legacy generic member_discount_percent is set,
//      fall back to a single "Members" row so older events keep working.
//   3. Otherwise, no callout.
//
// Accepts partial event rows so the caller doesn't have to hand-pick fields.
export function memberDiscountCalloutRows(event) {
  const cowork = coercePercent(event?.member_discount_percent_cowork);
  const iykyk  = coercePercent(event?.member_discount_percent_iykyk);

  const rows = [];
  if (cowork != null) rows.push({ key: 'cowork', label: MEMBER_TIER_DISPLAY.cowork.label, percent: cowork });
  if (iykyk  != null) rows.push({ key: 'iykyk',  label: MEMBER_TIER_DISPLAY.iykyk.label,  percent: iykyk });
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

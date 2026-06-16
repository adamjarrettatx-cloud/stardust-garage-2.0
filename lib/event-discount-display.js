// Pure display helpers for the member-discount callout shown on public event
// pages. Kept free of any '@/' alias imports (and any network/secret modules)
// so it can be unit-tested directly under `node --test`, the same constraint
// the other tested lib modules follow.

// Decide whether a public event page should show a "Members get N% OFF"
// callout, and what it should say. Driven ONLY by an explicit, configured
// per-event member_discount_percent — we deliberately do NOT fall back to a
// category default here, because the callout is a public promise and must
// reflect a discount the admin actually set. Returns { show, percent, text } so
// the JSX stays trivial and the decision is unit-testable. Accepts a numeric or
// numeric-string percent in 1..100; anything else means "don't show".
export function memberDiscountCallout(memberDiscountPercent) {
  if (
    memberDiscountPercent === null ||
    memberDiscountPercent === undefined ||
    memberDiscountPercent === ''
  ) {
    return { show: false, percent: null, text: null };
  }
  const pct =
    typeof memberDiscountPercent === 'number'
      ? memberDiscountPercent
      : Number(String(memberDiscountPercent).trim());
  if (!Number.isInteger(pct) || pct < 1 || pct > 100) {
    return { show: false, percent: null, text: null };
  }
  return { show: true, percent: pct, text: `Members get ${pct}% OFF` };
}

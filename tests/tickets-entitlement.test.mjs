import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolveEntitlementPercent,
  entitlementDiscountCents,
  pickDiscountCents,
  entitlementLabel,
  clampPercent,
  TRIAL_WEEKEND_MUSIC_DISCOUNT_PERCENT,
  ENTITLEMENT_MEMBER,
  ENTITLEMENT_TRIAL,
} from '../lib/tickets/entitlement.js';
import { isEntitledMember } from '../lib/tickets/entitlement-lookup.js';
import { computeHoldSnapshot } from '../lib/tickets/pricing.js';

const WEEKEND_MUSIC = { id: 'e1', category: 'party', is_weekend_music_experience: true };
const WEEKNIGHT = { id: 'e2', category: 'party', is_weekend_music_experience: false };

// --- The owner's rule ------------------------------------------------------
// "All TRIAL PASS accounts are immediately eligible for up to 25% off on
// Weekend Music Experiences." The number and its boundary are a business
// decision, so they get a test each.

test('a trial pass earns 25% off a Weekend Music Experience', () => {
  assert.equal(TRIAL_WEEKEND_MUSIC_DISCOUNT_PERCENT, 25);
  assert.equal(
    resolveEntitlementPercent(WEEKEND_MUSIC, { kind: ENTITLEMENT_TRIAL }),
    25,
  );
});

test('a trial pass earns nothing on an event that is not a Weekend Music Experience', () => {
  assert.equal(resolveEntitlementPercent(WEEKNIGHT, { kind: ENTITLEMENT_TRIAL }), 0);
});

test('a guest with no standing earns nothing', () => {
  assert.equal(resolveEntitlementPercent(WEEKEND_MUSIC, null), 0);
  assert.equal(resolveEntitlementPercent(WEEKEND_MUSIC, {}), 0);
  assert.equal(resolveEntitlementPercent(WEEKEND_MUSIC, { kind: 'nonsense' }), 0);
});

// --- Paid tiers keep the rates they already had ---------------------------

test('Weekender keeps its 25% weekend-music-only deal', () => {
  const ent = { kind: ENTITLEMENT_MEMBER, planKey: 'weekender' };
  assert.equal(resolveEntitlementPercent(WEEKEND_MUSIC, ent), 25);
  assert.equal(resolveEntitlementPercent(WEEKNIGHT, ent), 0);
});

test('per-plan and per-event overrides still win for Builder and Insider', () => {
  const event = { ...WEEKNIGHT, member_discount_percent_iykyk: 70, member_discount_percent: 45 };
  assert.equal(
    resolveEntitlementPercent(event, { kind: ENTITLEMENT_MEMBER, planKey: 'iykyk' }),
    70,
  );
  // cowork has no per-plan override here, so it falls to the legacy shared one.
  assert.equal(
    resolveEntitlementPercent(event, { kind: ENTITLEMENT_MEMBER, planKey: 'cowork' }),
    45,
  );
});

test('category default applies when an event sets no override', () => {
  // 'party' defaults to 60.
  assert.equal(
    resolveEntitlementPercent(WEEKNIGHT, { kind: ENTITLEMENT_MEMBER, planKey: 'cowork' }),
    60,
  );
});

// REGRESSION: member_profiles.subscription_plan can literally be 'trial'
// (there is such a row in production). getDiscountPercentForPlan has no case
// for it, so without the explicit branch it fell through to the category
// default and handed a trial 60% off a weeknight party.
test("a member on the 'trial' plan gets trial rates, not the category default", () => {
  const ent = { kind: ENTITLEMENT_MEMBER, planKey: 'trial' };
  assert.equal(resolveEntitlementPercent(WEEKEND_MUSIC, ent), 25);
  assert.equal(resolveEntitlementPercent(WEEKNIGHT, ent), 0);
});

test('an admin-entered override cannot exceed 100% or go negative', () => {
  assert.equal(clampPercent(250), 100);
  assert.equal(clampPercent(-5), 0);
  assert.equal(clampPercent('40'), 40);
  assert.equal(clampPercent(null), 0);
  assert.equal(clampPercent(24.9), 24);
  assert.equal(
    resolveEntitlementPercent(
      { ...WEEKNIGHT, member_discount_percent: 400 },
      { kind: ENTITLEMENT_MEMBER, planKey: 'cowork' },
    ),
    100,
  );
});

// --- Money math -----------------------------------------------------------

test('entitlement discount rounds down and ignores a zero percent', () => {
  assert.equal(entitlementDiscountCents(10000, 25), 2500);
  assert.equal(entitlementDiscountCents(3333, 25), 833); // 833.25 -> 833
  assert.equal(entitlementDiscountCents(10000, 0), 0);
  assert.equal(entitlementDiscountCents(0, 25), 0);
});

// --- No stacking ----------------------------------------------------------

test('the better of entitlement and code wins, and they never stack', () => {
  assert.deepEqual(
    pickDiscountCents({ codeCents: 1000, entitlementCents: 2500 }),
    { discountCents: 2500, source: 'entitlement' },
  );
  assert.deepEqual(
    pickDiscountCents({ codeCents: 4000, entitlementCents: 2500 }),
    { discountCents: 4000, source: 'code' },
  );
});

test('a tie goes to the code, so a redeemed code is never silently discarded', () => {
  assert.deepEqual(
    pickDiscountCents({ codeCents: 2500, entitlementCents: 2500 }),
    { discountCents: 2500, source: 'code' },
  );
});

test('no discount at all reports no source', () => {
  assert.deepEqual(
    pickDiscountCents({ codeCents: 0, entitlementCents: 0 }),
    { discountCents: 0, source: null },
  );
});

test('a target_total code wins outright even against a bigger entitlement', () => {
  // Exact-price instrument: letting 25% off beat it would undershoot the
  // number the code exists to produce.
  assert.deepEqual(
    pickDiscountCents({ codeCents: 500, entitlementCents: 9000, codeType: 'target_total' }),
    { discountCents: 500, source: 'code' },
  );
});

// --- Labels ---------------------------------------------------------------

test('the buyer sees which discount they got', () => {
  assert.equal(entitlementLabel({ kind: ENTITLEMENT_TRIAL }, 25), 'Trial pass — 25% off');
  assert.equal(
    entitlementLabel({ kind: ENTITLEMENT_MEMBER, planKey: 'iykyk' }, 60),
    'The Insider — 60% off',
  );
  assert.equal(
    entitlementLabel({ kind: ENTITLEMENT_MEMBER, planKey: 'weekender' }, 25),
    'The Weekender — 25% off',
  );
  assert.equal(entitlementLabel({ kind: ENTITLEMENT_MEMBER, planKey: 'trial' }, 25), 'Trial — 25% off');
  assert.equal(entitlementLabel(null, 25), null);
  assert.equal(entitlementLabel({ kind: ENTITLEMENT_TRIAL }, 0), null);
});

// --- Who counts as a member for pricing -----------------------------------

test('only an active or trialing membership prices as a member', () => {
  assert.equal(isEntitledMember({ is_active: true, subscription_status: 'active' }), true);
  assert.equal(isEntitledMember({ is_active: true, subscription_status: 'trialing' }), true);
  assert.equal(isEntitledMember({ is_active: true, subscription_status: 'past_due' }), false);
  assert.equal(isEntitledMember({ is_active: false, subscription_status: 'active' }), false);
  assert.equal(isEntitledMember({ is_active: true, subscription_status: 'pending' }), false);
  assert.equal(isEntitledMember(null), false);
});

// --- End to end through the snapshot the buyer is charged under ------------

function fixture() {
  return {
    selections: [{ product_id: 'p1', quantity: 2 }],
    productsById: new Map([['p1', { id: 'p1', is_active: true }]]),
    activeTierByProduct: new Map([['p1', { id: 't1', price_cents: 5000, currency: 'usd' }]]),
  };
}

test('computeHoldSnapshot defaults to no entitlement discount', () => {
  const snap = computeHoldSnapshot({ ...fixture() });
  assert.equal(snap.discountCents, 0);
  assert.equal(snap.entitlementPercent, 0);
  assert.equal(snap.discountSource, null);
});

test('a 25% entitlement comes off the ticket subtotal, not the booking fee', () => {
  const snap = computeHoldSnapshot({
    ...fixture(),
    event: { booking_fee_cents_default: 300, is_weekend_music_experience: true },
    entitlementPercent: 25,
  });
  assert.equal(snap.subtotalCents, 10000);
  assert.equal(snap.bookingFeeCents, 600); // 2 x 300, untouched by the discount
  assert.equal(snap.entitlementDiscountCents, 2500);
  assert.equal(snap.discountCents, 2500);
  assert.equal(snap.discountSource, 'entitlement');
  // Tax is charged on (subtotal - discount + fee) = 8100.
  assert.equal(snap.taxCents, Math.round((8100 * 825) / 10000));
  assert.equal(snap.totalCents, 8100 + snap.taxCents);
});

test('a weaker code loses to the entitlement and is reported as unused', () => {
  const snap = computeHoldSnapshot({
    ...fixture(),
    discountCode: { id: 'c1', is_active: true, discount_type: 'percent', discount_value: 10, applies_to: 'all' },
    entitlementPercent: 25,
  });
  assert.equal(snap.codeDiscountCents, 1000);
  assert.equal(snap.entitlementDiscountCents, 2500);
  assert.equal(snap.discountCents, 2500);
  assert.equal(snap.discountSource, 'entitlement');
});

test('a stronger code wins and the entitlement stands down', () => {
  const snap = computeHoldSnapshot({
    ...fixture(),
    discountCode: { id: 'c1', is_active: true, discount_type: 'percent', discount_value: 50, applies_to: 'all' },
    entitlementPercent: 25,
  });
  assert.equal(snap.discountCents, 5000);
  assert.equal(snap.discountSource, 'code');
});

// --- Guards on the route wiring -------------------------------------------

test('the hold route resolves the entitlement server-side, never from the body', () => {
  const src = readFileSync(new URL('../app/api/tickets/hold/route.js', import.meta.url), 'utf8');
  assert.match(src, /resolveBuyerEntitlement\(supabaseAdmin, user\.id/);
  assert.match(src, /entitlementPercent,/);
  // No path where the client hands us a percent.
  assert.ok(!/body\?\.entitlement/.test(src));
  assert.ok(!/body\.entitlement_percent/.test(src));
});

test('a losing discount code does not burn a redemption', () => {
  const src = readFileSync(new URL('../app/api/tickets/hold/route.js', import.meta.url), 'utf8');
  assert.match(src, /const codeWasApplied = Boolean\(discountCode\) && snapshot\.discountSource === 'code'/);
  assert.match(src, /if \(codeWasApplied\) \{\s*\n\s*const \{ error: incErr \}/);
  // Every rollback site keys off the same flag, or a lost code would have its
  // count decremented despite never being incremented.
  assert.ok(!/if \(discountCode\) \{\s*\n\s*await supabaseAdmin\s*\n\s*\.from\('ticket_discount_codes'\)/.test(src));
});

test('the entitlement preview endpoint stays display-only and never 401s a guest', () => {
  const src = readFileSync(new URL('../app/api/tickets/entitlement/route.js', import.meta.url), 'utf8');
  assert.match(src, /getRequestUser\(request\)/);
  assert.match(src, /if \(!user\) return NextResponse\.json\(none\)/);
});

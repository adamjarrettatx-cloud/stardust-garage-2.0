// End-to-end scenario verification of the tax + target_total feature.
//
// Exercises the real code paths a buyer hits at prod:
//   1. computeHoldSnapshot  (what the hold API stores + shows in the widget)
//   2. applyDiscountCode    (what /api/tickets/discount-code/validate returns)
//
// Every scenario mirrors a specific user story so a failure here is
// self-documenting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEXAS_SALES_TAX_RATE_BPS,
  computeTaxCents,
  applyDiscountCode,
  computeHoldSnapshot,
} from '../lib/tickets/pricing.js';

// Realistic fixtures matching how the hold route constructs its inputs.
function realWorldFixture({ ticketPriceCents = 2500, quantity = 2, bookingFeeDefault = 295 } = {}) {
  const productsById = new Map();
  productsById.set('prod_ga', { id: 'prod_ga', is_active: true, min_per_order: 1, max_per_order: 20 });
  const activeTierByProduct = new Map();
  activeTierByProduct.set('prod_ga', {
    id: 'tier_early',
    currency: 'usd',
    price_cents: ticketPriceCents,
    is_active: true,
    status: 'active',
  });
  return {
    selections: [{ product_id: 'prod_ga', quantity }],
    productsById,
    activeTierByProduct,
    event: { booking_fee_cents_default: bookingFeeDefault },
  };
}

const activeCode = (extras) => ({
  id: 'code_1',
  is_active: true,
  starts_at: null,
  ends_at: null,
  max_redemptions: null,
  redemptions_count: 0,
  applies_to: 'all_products',
  product_ids: null,
  ...extras,
});

// ---------------------------------------------------------------------------
// Scenario A: baseline ticket, no code, no member discount.
// A single $25 GA ticket + $2.95 booking fee, taxed at 8.25%.
// ---------------------------------------------------------------------------
test('Scenario A: bare $25 ticket \u2192 buyer sees subtotal + fee + tax', () => {
  const snap = computeHoldSnapshot(realWorldFixture({ quantity: 1 }));
  assert.equal(snap.subtotalCents, 2500);
  assert.equal(snap.bookingFeeCents, 295);
  assert.equal(snap.discountCents, 0);
  // pre-tax = 2795; tax = round(2795 * 0.0825) = round(230.5875) = 231
  assert.equal(snap.taxCents, 231);
  assert.equal(snap.totalCents, 2500 + 295 + 231); // $30.26
});

// ---------------------------------------------------------------------------
// Scenario B: 2x tickets, 10% off, then tax.
// ---------------------------------------------------------------------------
test('Scenario B: 2x $25 tickets with 10% off code \u2192 tax on discounted base', () => {
  const args = realWorldFixture({ quantity: 2 });
  const code = activeCode({ discount_type: 'percent', discount_value: 10 });
  const snap = computeHoldSnapshot({ ...args, discountCode: code });
  // subtotal 5000, discount 500, booking fee 2*295=590; pre-tax base = 5090
  // tax = round(5090 * 0.0825) = round(419.925) = 420
  assert.equal(snap.subtotalCents, 5000);
  assert.equal(snap.discountCents, 500);
  assert.equal(snap.bookingFeeCents, 590);
  assert.equal(snap.taxCents, 420);
  assert.equal(snap.totalCents, 5000 - 500 + 590 + 420); // $55.10
});

// ---------------------------------------------------------------------------
// Scenario C: TARGET_TOTAL \u2014 the promise. Adam creates a code that says
// "buyer sees exactly $50" \u2014 they should see exactly $50 at checkout.
// ---------------------------------------------------------------------------
test('Scenario C: target_total code lands buyer on EXACTLY the target price', () => {
  const args = realWorldFixture({ quantity: 2 }); // subtotal 5000, fee 590
  // Target: buyer pays exactly $50.00
  const code = activeCode({ discount_type: 'target_total', discount_value: 5000 });
  const snap = computeHoldSnapshot({ ...args, discountCode: code });
  assert.equal(snap.totalCents, 5000, `expected buyer to pay exactly \$50.00, got ${snap.totalCents}`);
  // Sanity: recompute the tax under the reported base and verify it matches.
  const recomputedTax = computeTaxCents(snap.subtotalCents - snap.discountCents + snap.bookingFeeCents);
  assert.equal(snap.taxCents, recomputedTax);
});

// ---------------------------------------------------------------------------
// Scenario D: target_total under a range of realistic price targets.
// Sweeps $10 to $100 in $0.50 steps and asserts either exact match OR at-or-
// under target within 1 cent (documented fallback).
// ---------------------------------------------------------------------------
test('Scenario D: target_total is exact or under-by-1c across $10\u2013$100 range', () => {
  const args = realWorldFixture({ ticketPriceCents: 10000, quantity: 1 }); // $100 ticket
  const failures = [];
  for (let target = 1000; target <= 10000; target += 50) {
    const code = activeCode({ discount_type: 'target_total', discount_value: target });
    let snap;
    try {
      snap = computeHoldSnapshot({ ...args, discountCode: code });
    } catch (err) {
      failures.push({ target, err: err.message });
      continue;
    }
    const diff = target - snap.totalCents; // >=0 means "at or under target"
    if (diff < 0 || diff > 1) {
      failures.push({ target, got: snap.totalCents, diff });
    }
  }
  assert.equal(failures.length, 0, `target_total mispriced at: ${JSON.stringify(failures.slice(0, 10))}`);
});

// ---------------------------------------------------------------------------
// Scenario E: target_total > eligible subtotal \u2192 discount clamps to 0
// (buyer pays their full subtotal + fee + tax; code effectively no-ops).
// ---------------------------------------------------------------------------
test('Scenario E: target_total above what\'s reachable no-ops the code', () => {
  const args = realWorldFixture({ quantity: 1 }); // subtotal 2500, fee 295
  const code = activeCode({ discount_type: 'target_total', discount_value: 99999999 });
  const snap = computeHoldSnapshot({ ...args, discountCode: code });
  assert.equal(snap.discountCents, 0);
  assert.equal(snap.totalCents, 2500 + 295 + 231); // matches Scenario A
});

// ---------------------------------------------------------------------------
// Scenario F: /api/tickets/discount-code/validate contract \u2014 the preview
// endpoint must return the SAME discountCents the hold API will compute.
// We simulate the route's call shape.
// ---------------------------------------------------------------------------
test('Scenario F: validate route preview matches hold-time computation', () => {
  // Same cart the buyer widget would send.
  const items = [
    { product_id: 'prod_ga', quantity: 2, unit_price_cents: 2500 },
  ];
  const bookingFeeCents = 590;
  const code = activeCode({ discount_type: 'target_total', discount_value: 5000 });

  // Preview (what validate returns to the widget).
  const preview = applyDiscountCode({
    code,
    items,
    productsById: new Map(),
    bookingFeeCents,
  });

  // Hold-time (what the hold API stores).
  const args = realWorldFixture({ quantity: 2 });
  const snap = computeHoldSnapshot({ ...args, discountCode: code });

  assert.equal(preview.discountCents, snap.discountCents,
    `validate preview ${preview.discountCents} != hold-time ${snap.discountCents}`);
});

// ---------------------------------------------------------------------------
// Scenario G: tax_rate_bps is exported as 825 (source of truth for widget).
// ---------------------------------------------------------------------------
test('Scenario G: TEXAS_SALES_TAX_RATE_BPS is 825', () => {
  assert.equal(TEXAS_SALES_TAX_RATE_BPS, 825);
});

// ---------------------------------------------------------------------------
// Scenario H: 'amount' code still stacks cleanly with tax.
// ---------------------------------------------------------------------------
test('Scenario H: $10-off amount code taxes the DISCOUNTED base', () => {
  const args = realWorldFixture({ quantity: 2 }); // subtotal 5000, fee 590
  const code = activeCode({ discount_type: 'amount', discount_value: 1000 });
  const snap = computeHoldSnapshot({ ...args, discountCode: code });
  assert.equal(snap.discountCents, 1000);
  // pre-tax = 5000 - 1000 + 590 = 4590; tax = round(4590 * 0.0825) = round(378.675) = 379
  assert.equal(snap.taxCents, 379);
  assert.equal(snap.totalCents, 4590 + 379); // $49.69
});

// ---------------------------------------------------------------------------
// Scenario I: 100% off percent code -> subtotal 0, tax only on booking fee.
// Confirms the booking fee is always taxed even when tickets are free.
// ---------------------------------------------------------------------------
test('Scenario I: 100% off leaves buyer paying booking fee + tax on booking fee', () => {
  const args = realWorldFixture({ quantity: 1 }); // subtotal 2500, fee 295
  const code = activeCode({ discount_type: 'percent', discount_value: 100 });
  const snap = computeHoldSnapshot({ ...args, discountCode: code });
  assert.equal(snap.discountCents, 2500);
  assert.equal(snap.bookingFeeCents, 295);
  // pre-tax base = 0 + 295; tax = round(295 * 0.0825) = round(24.3375) = 24
  assert.equal(snap.taxCents, 24);
  assert.equal(snap.totalCents, 295 + 24); // $3.19
});

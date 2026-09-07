import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEXAS_SALES_TAX_RATE_BPS,
  computeTaxCents,
  applyDiscountCode,
  computeHoldSnapshot,
} from '../lib/tickets/pricing.js';

// -- computeTaxCents ---------------------------------------------------------
test('computeTaxCents applies the Texas 8.25% rate with half-up rounding', () => {
  assert.equal(computeTaxCents(10000), 825); // $100 * 0.0825 = $8.25
  assert.equal(computeTaxCents(0), 0);
  assert.equal(computeTaxCents(1), 0);       // $0.01 * 0.0825 = 0.0825 => 0 (Math.round(0.0825))
  assert.equal(computeTaxCents(1234), 102);  // $12.34 * 0.0825 = 1.01805 => 102 cents ($1.02)
});

test('computeTaxCents clamps negatives to zero', () => {
  assert.equal(computeTaxCents(-500), 0);
});

test('computeTaxCents accepts a custom rate override', () => {
  assert.equal(computeTaxCents(10000, 1000), 1000); // 10% flat
});

// -- computeHoldSnapshot: tax pipeline --------------------------------------
function fakeSelections() {
  const productsById = new Map();
  productsById.set('p1', { id: 'p1', is_active: true });
  const activeTierByProduct = new Map();
  activeTierByProduct.set('p1', { id: 't1', currency: 'usd', price_cents: 5000 });
  const event = { booking_fee_cents_default: 295 };
  return {
    selections: [{ product_id: 'p1', quantity: 2 }],
    productsById,
    activeTierByProduct,
    event,
  };
}

test('computeHoldSnapshot adds Texas sales tax on (subtotal + booking_fee)', () => {
  const snap = computeHoldSnapshot(fakeSelections());
  // subtotal 10000, booking fee 2 * 295 = 590, pre-tax 10590
  // tax = round(10590 * 0.0825) = round(873.675) = 874
  assert.equal(snap.subtotalCents, 10000);
  assert.equal(snap.bookingFeeCents, 590);
  assert.equal(snap.discountCents, 0);
  assert.equal(snap.taxCents, 874);
  assert.equal(snap.taxRateBps, TEXAS_SALES_TAX_RATE_BPS);
  assert.equal(snap.totalCents, 10000 + 590 + 874);
});

test('computeHoldSnapshot returns 0 tax when total is 0', () => {
  const productsById = new Map();
  productsById.set('p1', { id: 'p1', is_active: true });
  const activeTierByProduct = new Map();
  activeTierByProduct.set('p1', { id: 't1', currency: 'usd', price_cents: 0 });
  const snap = computeHoldSnapshot({
    selections: [{ product_id: 'p1', quantity: 1 }],
    productsById,
    activeTierByProduct,
    // No event => no booking fee.
  });
  assert.equal(snap.taxCents, 0);
  assert.equal(snap.totalCents, 0);
});

// -- applyDiscountCode: percent + amount still work with new signature -------
const codeBase = {
  id: 'c',
  is_active: true,
  starts_at: null,
  ends_at: null,
  max_redemptions: null,
  redemptions_count: 0,
  applies_to: 'all_products',
  product_ids: null,
};
const items = [{ product_id: 'p1', quantity: 2, unit_price_cents: 5000 }];

test('applyDiscountCode: percent code unchanged by tax + booking fee args', () => {
  const { discountCents } = applyDiscountCode({
    code: { ...codeBase, discount_type: 'percent', discount_value: 10 },
    items,
    productsById: new Map(),
    bookingFeeCents: 590,
  });
  assert.equal(discountCents, 1000); // 10% of $100
});

test('applyDiscountCode: amount code unchanged by tax + booking fee args', () => {
  const { discountCents } = applyDiscountCode({
    code: { ...codeBase, discount_type: 'amount', discount_value: 1500 },
    items,
    productsById: new Map(),
    bookingFeeCents: 590,
  });
  assert.equal(discountCents, 1500);
});

test('applyDiscountCode: amount code clamps to eligible subtotal', () => {
  const { discountCents } = applyDiscountCode({
    code: { ...codeBase, discount_type: 'amount', discount_value: 999999 },
    items,
    productsById: new Map(),
  });
  assert.equal(discountCents, 10000);
});

// -- applyDiscountCode: target_total -----------------------------------------
test('applyDiscountCode: target_total back-solves so buyer sees exactly the target', () => {
  // Subtotal 10000, booking fee 590, target = $50.00 = 5000 cents.
  // We need discountCents such that (10000 - d + 590) * 1.0825 (rounded) == 5000.
  const { discountCents } = applyDiscountCode({
    code: { ...codeBase, discount_type: 'target_total', discount_value: 5000 },
    items,
    productsById: new Map(),
    bookingFeeCents: 590,
  });
  const preTax = 10000 - discountCents + 590;
  const finalCents = preTax + computeTaxCents(preTax);
  assert.equal(finalCents, 5000, `expected 5000, got ${finalCents} at d=${discountCents}`);
});

test('applyDiscountCode: target_total works with zero booking fee', () => {
  // $25.00 isn't reachable to the cent under 8.25% rounding, so the fallback
  // must land AT OR UNDER the target and be off by no more than 1 cent.
  const { discountCents } = applyDiscountCode({
    code: { ...codeBase, discount_type: 'target_total', discount_value: 2500 },
    items,
    productsById: new Map(),
    bookingFeeCents: 0,
  });
  const preTax = 10000 - discountCents;
  const finalCents = preTax + computeTaxCents(preTax);
  assert(finalCents <= 2500 && 2500 - finalCents <= 1, `expected finalCents<=2500 within 1c, got ${finalCents}`);
});

test('applyDiscountCode: target_total clamps discount to [0, eligibleSubtotal]', () => {
  // Target higher than possible => discount = 0.
  const { discountCents: dHigh } = applyDiscountCode({
    code: { ...codeBase, discount_type: 'target_total', discount_value: 99999999 },
    items,
    productsById: new Map(),
    bookingFeeCents: 590,
  });
  assert.equal(dHigh, 0);

  // Target = 0 => discount can go up to eligible subtotal (buyer pays 0).
  const { discountCents: dZero } = applyDiscountCode({
    code: { ...codeBase, discount_type: 'target_total', discount_value: 0 },
    items,
    productsById: new Map(),
    bookingFeeCents: 590,
  });
  assert(dZero >= 0 && dZero <= 10000);
});

test('applyDiscountCode: target_total end-to-end via computeHoldSnapshot', () => {
  const args = fakeSelections();
  const discountCode = {
    ...codeBase,
    discount_type: 'target_total',
    discount_value: 6000, // buyer sees $60.00
  };
  const snap = computeHoldSnapshot({ ...args, discountCode });
  assert.equal(snap.totalCents, 6000);
  assert.equal(snap.taxCents, computeTaxCents(snap.subtotalCents - snap.discountCents + snap.bookingFeeCents));
});

test('applyDiscountCode: rejects unknown discount_type', () => {
  assert.throws(
    () =>
      applyDiscountCode({
        code: { ...codeBase, discount_type: 'nonsense', discount_value: 100 },
        items,
        productsById: new Map(),
      }),
    /DISCOUNT_INVALID/,
  );
});

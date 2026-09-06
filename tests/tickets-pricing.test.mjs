import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectActiveTier, computeHoldSnapshot, isProductOnSale } from '../lib/tickets/pricing.js';

// selectActiveTier ----------------------------------------------------------
test('selectActiveTier ignores inactive tiers', () => {
  const t = selectActiveTier([
    { id: 'a', is_active: false, price_cents: 1000 },
    { id: 'b', is_active: true, price_cents: 2000 },
  ]);
  assert.equal(t.id, 'b');
});

test('selectActiveTier respects starts_at / ends_at windows', () => {
  const now = new Date('2026-09-06T12:00:00Z');
  const t = selectActiveTier([
    { id: 'earlybird', is_active: true, starts_at: '2026-01-01', ends_at: '2026-09-06T11:00:00Z', price_cents: 500, display_order: 0 },
    { id: 'regular',   is_active: true, starts_at: '2026-09-06T11:00:00Z', price_cents: 1000, display_order: 1 },
  ], { now });
  assert.equal(t.id, 'regular');
});

test('selectActiveTier prefers lower display_order among eligible tiers', () => {
  const t = selectActiveTier([
    { id: 'promo',   is_active: true, price_cents: 500, display_order: 0 },
    { id: 'regular', is_active: true, price_cents: 1000, display_order: 1 },
  ]);
  assert.equal(t.id, 'promo');
});

test('selectActiveTier returns null when nothing is active', () => {
  assert.equal(selectActiveTier([]), null);
  assert.equal(selectActiveTier(null), null);
});

// computeHoldSnapshot -------------------------------------------------------
function fixture() {
  const productsById = new Map([
    ['p1', { id: 'p1', is_active: true, min_per_order: 1, max_per_order: 8 }],
    ['p2', { id: 'p2', is_active: true, min_per_order: 2, max_per_order: 4 }],
  ]);
  const activeTierByProduct = new Map([
    ['p1', { id: 't1', price_cents: 2500, currency: 'usd' }],
    ['p2', { id: 't2', price_cents: 5000, currency: 'usd' }],
  ]);
  return { productsById, activeTierByProduct };
}

test('computeHoldSnapshot sums line items into a subtotal in cents', () => {
  const f = fixture();
  const snap = computeHoldSnapshot({
    selections: [{ product_id: 'p1', quantity: 2 }, { product_id: 'p2', quantity: 3 }],
    ...f,
  });
  assert.equal(snap.subtotalCents, 2 * 2500 + 3 * 5000);
  assert.equal(snap.quantityTotal, 5);
  assert.equal(snap.currency, 'usd');
  assert.equal(snap.items.length, 2);
  assert.deepEqual(snap.items[0], { product_id: 'p1', tier_id: 't1', quantity: 2, unit_price_cents: 2500 });
});

test('computeHoldSnapshot rejects empty and non-array selections', () => {
  const f = fixture();
  assert.throws(() => computeHoldSnapshot({ selections: [], ...f }), /EMPTY_SELECTION/);
  assert.throws(() => computeHoldSnapshot({ selections: null, ...f }), /EMPTY_SELECTION/);
});

test('computeHoldSnapshot enforces min/max per order', () => {
  const f = fixture();
  assert.throws(() => computeHoldSnapshot({ selections: [{ product_id: 'p2', quantity: 1 }], ...f }), /BELOW_MIN_PER_ORDER/);
  assert.throws(() => computeHoldSnapshot({ selections: [{ product_id: 'p1', quantity: 9 }], ...f }), /ABOVE_MAX_PER_ORDER/);
});

test('computeHoldSnapshot rejects unknown or inactive product', () => {
  const f = fixture();
  assert.throws(() => computeHoldSnapshot({ selections: [{ product_id: 'ghost', quantity: 1 }], ...f }), /UNKNOWN_PRODUCT/);
  f.productsById.set('p1', { ...f.productsById.get('p1'), is_active: false });
  assert.throws(() => computeHoldSnapshot({ selections: [{ product_id: 'p1', quantity: 1 }], ...f }), /PRODUCT_INACTIVE/);
});

test('computeHoldSnapshot rejects non-integer quantity', () => {
  const f = fixture();
  assert.throws(() => computeHoldSnapshot({ selections: [{ product_id: 'p1', quantity: 1.5 }], ...f }), /INVALID_QUANTITY/);
  assert.throws(() => computeHoldSnapshot({ selections: [{ product_id: 'p1', quantity: 0 }], ...f }), /INVALID_QUANTITY/);
});

test('computeHoldSnapshot enforces missing active tier as error', () => {
  const f = fixture();
  f.activeTierByProduct.delete('p1');
  assert.throws(() => computeHoldSnapshot({ selections: [{ product_id: 'p1', quantity: 1 }], ...f }), /NO_ACTIVE_TIER/);
});

test('computeHoldSnapshot rejects mixed currencies', () => {
  const f = fixture();
  f.activeTierByProduct.set('p2', { id: 't2', price_cents: 5000, currency: 'eur' });
  assert.throws(() => computeHoldSnapshot({ selections: [{ product_id: 'p1', quantity: 1 }, { product_id: 'p2', quantity: 2 }], ...f }), /CURRENCY_MISMATCH/);
});

// isProductOnSale -----------------------------------------------------------
test('isProductOnSale respects sales window', () => {
  const now = new Date('2026-09-06T12:00:00Z');
  assert.equal(isProductOnSale({ is_active: true }, now), true);
  assert.equal(isProductOnSale({ is_active: false }, now), false);
  assert.equal(isProductOnSale({ is_active: true, sales_start_at: '2026-09-06T13:00:00Z' }, now), false);
  assert.equal(isProductOnSale({ is_active: true, sales_end_at: '2026-09-06T11:00:00Z' }, now), false);
  assert.equal(isProductOnSale({ is_active: true, sales_start_at: '2026-09-01', sales_end_at: '2026-09-30' }, now), true);
});

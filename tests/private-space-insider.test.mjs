import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeHoldSnapshot } from '../lib/tickets/pricing.js';
import { discountedCheckoutLines } from '../lib/tickets/checkout-lines.js';
import {
  resolveRentalEntitlementPercent,
  entitlementLabel,
  ENTITLEMENT_MEMBER,
  ENTITLEMENT_TRIAL,
} from '../lib/tickets/entitlement.js';
import {
  INSIDER_PRIVATE_SPACE_DISCOUNT_PERCENT,
  insiderPrivateSpacePriceCents,
} from '../lib/membership-tiers.js';

const products = new Map([
  ['tix', { id: 'tix', kind: 'tickets', is_active: true }],
  ['room', { id: 'room', kind: 'private_space', is_active: true }],
]);
const tiers = new Map([
  ['tix', { id: 't1', price_cents: 2000, currency: 'usd' }],
  ['room', { id: 't2', price_cents: 75000, currency: 'usd' }],
]);

test('only an active Insider earns the rental discount', () => {
  assert.equal(INSIDER_PRIVATE_SPACE_DISCOUNT_PERCENT, 20);
  assert.equal(resolveRentalEntitlementPercent({ kind: ENTITLEMENT_MEMBER, planKey: 'iykyk' }), 20);
  for (const planKey of ['weekender', 'cowork', 'trial', 'unknown', null]) {
    assert.equal(resolveRentalEntitlementPercent({ kind: ENTITLEMENT_MEMBER, planKey }), 0);
  }
  assert.equal(resolveRentalEntitlementPercent({ kind: ENTITLEMENT_TRIAL }), 0);
  assert.equal(resolveRentalEntitlementPercent(null), 0);
});

test('advertised Insider price matches the checkout rounding', () => {
  assert.equal(insiderPrivateSpacePriceCents(75000), 60000);
  assert.equal(insiderPrivateSpacePriceCents(33333), 33333 - 6666);
});

test('Insider pays 20% off a rental, never the event ticket percent', () => {
  const snap = computeHoldSnapshot({
    selections: [{ product_id: 'room', quantity: 1 }],
    productsById: products,
    activeTierByProduct: tiers,
    entitlementPercent: 60,
    rentalEntitlementPercent: 20,
  });
  assert.equal(snap.discountCents, 15000);
  assert.equal(snap.discountSource, 'entitlement');
  assert.equal(snap.rentalEntitlementDiscountCents, 15000);
  assert.equal(snap.ticketEntitlementDiscountCents, 0);
  const lines = discountedCheckoutLines(snap, products);
  assert.deepEqual(lines.map((l) => [l.product_id, l.unit_price_cents]), [['room', 60000]]);
});

test('mixed cart applies each percent only to its own lines', () => {
  const snap = computeHoldSnapshot({
    selections: [{ product_id: 'tix', quantity: 2 }, { product_id: 'room', quantity: 1 }],
    productsById: products,
    activeTierByProduct: tiers,
    entitlementPercent: 60,
    rentalEntitlementPercent: 20,
  });
  assert.equal(snap.ticketEntitlementDiscountCents, 2400);
  assert.equal(snap.rentalEntitlementDiscountCents, 15000);
  assert.equal(snap.discountCents, 17400);
  const lines = discountedCheckoutLines(snap, products);
  const total = (id) => lines.filter((l) => l.product_id === id).reduce((s, l) => s + l.unit_price_cents * l.quantity, 0);
  assert.equal(total('tix'), 1600);
  assert.equal(total('room'), 60000);
  assert.ok(lines.every((l) => !('__discounted' in l)));
});

test('non-members pay the sticker price for a rental', () => {
  const snap = computeHoldSnapshot({
    selections: [{ product_id: 'room', quantity: 1 }],
    productsById: products,
    activeTierByProduct: tiers,
  });
  assert.equal(snap.discountCents, 0);
  assert.equal(snap.subtotalCents, 75000);
});

test('label names the rental benefit', () => {
  const insider = { kind: ENTITLEMENT_MEMBER, planKey: 'iykyk' };
  assert.equal(entitlementLabel(insider, 0, 20), 'The Insider — 20% off private space');
  assert.equal(entitlementLabel(insider, 30, 20), 'The Insider — 30% off tickets, 20% off private space');
  assert.equal(entitlementLabel(insider, 30, 0), 'The Insider — 30% off');
});

test('checkout never gates a private space on membership', () => {
  const hold = readFileSync(new URL('../app/api/tickets/hold/route.js', import.meta.url), 'utf8');
  assert.match(hold, /p\.member_only && p\.kind !== 'private_space'/);
  const manager = readFileSync(new URL('../components/ticketing/PrivateSpacesManager.jsx', import.meta.url), 'utf8');
  assert.match(manager, /member_only: false/);
});

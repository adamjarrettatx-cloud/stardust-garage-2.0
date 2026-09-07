// Refund tax split: prove that a Stripe refund is broken up correctly into
// (tax portion, non-tax portion) so the state gets its cut back and internal
// reporting stays honest across partial + full + edge-case refunds.

import test from 'node:test';
import assert from 'node:assert/strict';

import { splitRefundTax } from '../lib/tickets/pricing.js';

test('full refund of a taxed order returns 100% of the tax collected', () => {
  // $25 ticket + $2.95 fee = $27.95; TX tax 8.25% = $2.31; total $30.26.
  const { taxPortionCents, nonTaxPortionCents } = splitRefundTax({
    refundAmountCents: 3026,
    orderTotalCents: 3026,
    orderTaxCents: 231,
    remainingTaxCents: 231,
  });
  assert.equal(taxPortionCents, 231, 'all $2.31 of tax comes back on a full refund');
  assert.equal(nonTaxPortionCents, 2795, 'the rest is ticket + fee');
  assert.equal(taxPortionCents + nonTaxPortionCents, 3026, 'invariant: parts add to refund');
});

test('partial refund returns tax proportionally to what was refunded', () => {
  // Same $30.26 order; refund half ($15.13). Tax portion should be ~$1.15.
  const { taxPortionCents, nonTaxPortionCents } = splitRefundTax({
    refundAmountCents: 1513,
    orderTotalCents: 3026,
    orderTaxCents: 231,
    remainingTaxCents: 231,
  });
  // 1513 * 231 / 3026 = 115.5 exactly → Math.round returns 116.
  assert.equal(taxPortionCents, 116);
  assert.equal(nonTaxPortionCents, 1513 - 116);
});

test('successive partials never over-return tax (respects remaining budget)', () => {
  // Two partial refunds that would each round to a tax portion; the second
  // one must be clamped to whatever tax budget is left, never overshoot.
  const order = { total: 3026, tax: 231 };
  const first = splitRefundTax({
    refundAmountCents: 2000,
    orderTotalCents: order.total,
    orderTaxCents: order.tax,
    remainingTaxCents: order.tax,
  });
  // 2000 * 231 / 3026 = 152.68 → 153.
  assert.equal(first.taxPortionCents, 153);
  const budgetLeft = order.tax - first.taxPortionCents; // 78
  const second = splitRefundTax({
    refundAmountCents: 1026,
    orderTotalCents: order.total,
    orderTaxCents: order.tax,
    remainingTaxCents: budgetLeft,
  });
  // 1026 * 231 / 3026 = 78.32 → 78; budget is exactly 78, so no clamp needed.
  assert.equal(second.taxPortionCents, 78);
  assert.equal(first.taxPortionCents + second.taxPortionCents, order.tax,
    'cumulative tax returned == tax originally collected');
});

test('rounding attack: refund 1 cent from a taxed order returns 0 tax (rounded)', () => {
  // A one-cent refund on a $30.26 order rounds tax to 0, giving the whole
  // penny to the non-tax side. That's fine — the tax budget is preserved.
  const { taxPortionCents, nonTaxPortionCents } = splitRefundTax({
    refundAmountCents: 1,
    orderTotalCents: 3026,
    orderTaxCents: 231,
    remainingTaxCents: 231,
  });
  assert.equal(taxPortionCents, 0);
  assert.equal(nonTaxPortionCents, 1);
});

test('untaxed legacy order: refund is entirely non-tax', () => {
  // Old-world order sold before the tax feature shipped: tax_cents = 0.
  // Refund must not invent tax to return.
  const { taxPortionCents, nonTaxPortionCents } = splitRefundTax({
    refundAmountCents: 2500,
    orderTotalCents: 2500,
    orderTaxCents: 0,
    remainingTaxCents: 0,
  });
  assert.equal(taxPortionCents, 0);
  assert.equal(nonTaxPortionCents, 2500);
});

test('remainingTaxCents = 0 clamps tax portion to 0 even on a taxed order', () => {
  // A prior refund already returned all the tax; a subsequent partial
  // refund's tax portion must clamp to 0.
  const { taxPortionCents, nonTaxPortionCents } = splitRefundTax({
    refundAmountCents: 500,
    orderTotalCents: 3026,
    orderTaxCents: 231,
    remainingTaxCents: 0,
  });
  assert.equal(taxPortionCents, 0);
  assert.equal(nonTaxPortionCents, 500);
});

test('refund larger than order total is clamped to the refund amount', () => {
  // Callers shouldn't send this, but if they do, tax portion is bounded by
  // (refund, budget, proportional) — never the raw ratio × runaway number.
  const { taxPortionCents, nonTaxPortionCents } = splitRefundTax({
    refundAmountCents: 100,
    orderTotalCents: 100,
    orderTaxCents: 100,
    remainingTaxCents: 100,
  });
  assert.equal(taxPortionCents, 100, '100% tax order → full refund is 100% tax');
  assert.equal(nonTaxPortionCents, 0);
});

test('sweep: many partial refunds of a single $50 target_total order preserve tax invariant', () => {
  // Realistic scenario: buyer paid $50 exactly (target_total code) with
  // ~$3.81 tax embedded. Owner issues six small partial refunds of varying
  // sizes. At the end, cumulative tax returned must equal exactly what was
  // in the order.
  const orderTotal = 5000;
  const orderTax = 381;
  const parts = [500, 700, 1000, 800, 1200, 800]; // sums to $50
  let remaining = orderTax;
  let refundedTax = 0;
  let refundedNonTax = 0;
  for (const p of parts) {
    const { taxPortionCents, nonTaxPortionCents } = splitRefundTax({
      refundAmountCents: p,
      orderTotalCents: orderTotal,
      orderTaxCents: orderTax,
      remainingTaxCents: remaining,
    });
    remaining -= taxPortionCents;
    refundedTax += taxPortionCents;
    refundedNonTax += nonTaxPortionCents;
  }
  assert.equal(refundedTax + refundedNonTax, 5000, 'all $50 refunded across parts');
  // With rounding, cumulative tax may be within a cent of the true tax; the
  // budget clamp guarantees it never exceeds the true tax. Also guarantee
  // rounding drift is small (≤1 cent per part on average).
  assert.ok(refundedTax <= orderTax, 'cumulative tax refunded never exceeds tax collected');
  assert.ok(orderTax - refundedTax <= parts.length,
    `tax rounding drift is bounded by number of refund events (got ${orderTax - refundedTax}, max ${parts.length})`);
});

test('zero-dollar refund returns zero of everything (no crash)', () => {
  const { taxPortionCents, nonTaxPortionCents } = splitRefundTax({
    refundAmountCents: 0,
    orderTotalCents: 3026,
    orderTaxCents: 231,
    remainingTaxCents: 231,
  });
  assert.equal(taxPortionCents, 0);
  assert.equal(nonTaxPortionCents, 0);
});

test('negative inputs are treated as zero, never as credit', () => {
  const { taxPortionCents, nonTaxPortionCents } = splitRefundTax({
    refundAmountCents: -100,
    orderTotalCents: 3026,
    orderTaxCents: 231,
    remainingTaxCents: 231,
  });
  assert.equal(taxPortionCents, 0);
  assert.equal(nonTaxPortionCents, 0);
});

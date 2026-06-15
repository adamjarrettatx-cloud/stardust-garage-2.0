import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcLine,
  calcCart,
  validateTenderForCart,
  allowedTendersForCart,
  effectiveTaxBps,
  isValidTender,
  isValidRestrictedPolicy,
  formatOrderNumber,
} from '../lib/pos-helpers.js';
import {
  getPaymentAdapter,
  isPhase1Tender,
  PaymentError,
} from '../lib/pos-payments.js';

// ---------------------------------------------------------------------------
// Line + cart calculation
// ---------------------------------------------------------------------------
test('calcLine multiplies price by quantity and applies tax in cents', () => {
  const line = calcLine({ price_cents: 1000, quantity: 3, tax_rate_bps: 825, taxable: true });
  assert.equal(line.subtotal_cents, 3000);
  assert.equal(line.tax_cents, 248); // 3000 * 0.0825 = 247.5 -> 248 half-up
  assert.equal(line.line_total_cents, 3248);
});

test('calcLine respects non-taxable products', () => {
  const line = calcLine({ price_cents: 1000, quantity: 2, tax_rate_bps: 825, taxable: false });
  assert.equal(line.tax_cents, 0);
  assert.equal(line.line_total_cents, 2000);
});

test('calcLine applies per-line discount before tax', () => {
  const line = calcLine({ price_cents: 1000, quantity: 1, discount_cents: 200, tax_rate_bps: 1000, taxable: true });
  assert.equal(line.subtotal_cents, 800);
  assert.equal(line.tax_cents, 80);
  assert.equal(line.line_total_cents, 880);
});

test('effectiveTaxBps returns 0 for non-taxable', () => {
  assert.equal(effectiveTaxBps({ taxable: false, tax_rate_bps: 825 }), 0);
  assert.equal(effectiveTaxBps({ taxable: true, tax_rate_bps: 825 }), 825);
});

test('calcCart sums lines and an order-level discount', () => {
  const cart = calcCart([
    { price_cents: 1000, quantity: 2, tax_rate_bps: 0, taxable: false },
    { price_cents: 500, quantity: 1, tax_rate_bps: 0, taxable: false },
  ], 300);
  assert.equal(cart.subtotal_cents, 2500);
  assert.equal(cart.tax_cents, 0);
  assert.equal(cart.discount_cents, 300);
  assert.equal(cart.total_cents, 2200);
});

test('calcCart caps an order discount at the subtotal (never negative)', () => {
  const cart = calcCart([{ price_cents: 1000, quantity: 1, taxable: false }], 99999);
  assert.equal(cart.total_cents, 0);
  assert.equal(cart.discount_cents, 1000);
});

test('calcCart flags restricted items present', () => {
  const cart = calcCart([
    { price_cents: 1000, quantity: 1, taxable: false, restricted_tender_policy: 'cash_only' },
  ]);
  assert.equal(cart.restricted_items_present, true);
  const plain = calcCart([{ price_cents: 1000, quantity: 1, taxable: false }]);
  assert.equal(plain.restricted_items_present, false);
});

test('calcCart handles empty / invalid input safely', () => {
  assert.equal(calcCart([]).total_cents, 0);
  assert.equal(calcCart(null).total_cents, 0);
});

// ---------------------------------------------------------------------------
// Restricted-tender validation — the core compliance rule
// ---------------------------------------------------------------------------
test('cash_only item allows cash, blocks every other tender', () => {
  const cart = [{ name: 'THCA Flower', restricted_tender_policy: 'cash_only', price_cents: 2000, quantity: 1 }];
  assert.equal(validateTenderForCart(cart, 'cash').allowed, true);
  assert.equal(validateTenderForCart(cart, 'card').allowed, false);
  assert.equal(validateTenderForCart(cart, 'manual_external').allowed, false);
  assert.equal(validateTenderForCart(cart, 'ach').allowed, false);
});

test('approved_processor_only blocks mainstream card/ACH but allows cash + out-of-band', () => {
  const cart = [{ name: 'Kava Drink', restricted_tender_policy: 'approved_processor_only', price_cents: 1200, quantity: 1 }];
  assert.equal(validateTenderForCart(cart, 'cash').allowed, true);
  assert.equal(validateTenderForCart(cart, 'manual_external').allowed, true);
  assert.equal(validateTenderForCart(cart, 'comp').allowed, true);
  assert.equal(validateTenderForCart(cart, 'card').allowed, false);
  assert.equal(validateTenderForCart(cart, 'ach').allowed, false);
});

test('unrestricted items allow any valid tender', () => {
  const cart = [{ name: 'Coffee', restricted_tender_policy: 'none', price_cents: 400, quantity: 1 }];
  for (const tender of ['cash', 'card', 'manual_external', 'ach', 'comp']) {
    assert.equal(validateTenderForCart(cart, tender).allowed, true, tender);
  }
});

test('mixed cart with a cash_only item blocks card for the whole sale', () => {
  const cart = [
    { name: 'Coffee', restricted_tender_policy: 'none', price_cents: 400, quantity: 1 },
    { name: 'Kanna', restricted_tender_policy: 'cash_only', price_cents: 1500, quantity: 1 },
  ];
  const res = validateTenderForCart(cart, 'card');
  assert.equal(res.allowed, false);
  assert.match(res.reason, /Kanna/);
});

test('validateTenderForCart rejects unknown tender', () => {
  assert.equal(validateTenderForCart([], 'bitcoin').allowed, false);
});

test('allowedTendersForCart disables card paths for cash-only carts', () => {
  const cart = [{ name: 'THCA', restricted_tender_policy: 'cash_only', price_cents: 2000, quantity: 1 }];
  const map = Object.fromEntries(allowedTendersForCart(cart).map((t) => [t.value, t.enabled]));
  assert.equal(map.cash, true);
  assert.equal(map.manual_external, false);
  // Only Phase-1 tenders are surfaced.
  assert.equal('card' in map, false);
  assert.equal('ach' in map, false);
});

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------
test('isValidTender / isValidRestrictedPolicy', () => {
  assert.equal(isValidTender('cash'), true);
  assert.equal(isValidTender('crypto'), false);
  assert.equal(isValidRestrictedPolicy('cash_only'), true);
  assert.equal(isValidRestrictedPolicy('nope'), false);
});

test('formatOrderNumber zero-pads with year', () => {
  const n = formatOrderNumber(123, new Date('2026-01-01T00:00:00Z'));
  assert.equal(n, 'SG-2026-000123');
});

// ---------------------------------------------------------------------------
// Payment adapters (Phase 1)
// ---------------------------------------------------------------------------
test('cash adapter captures without a processor', async () => {
  const adapter = getPaymentAdapter('cash');
  const res = await adapter.capture({ amount_cents: 500 });
  assert.equal(res.status, 'succeeded');
  assert.equal(res.processor_key, null);
  assert.equal(res.amount_cents, 500);
});

test('manual_external adapter records a reference, no network', async () => {
  const adapter = getPaymentAdapter('manual_external');
  const res = await adapter.capture({ amount_cents: 1500, reference: 'AUTH-9921' });
  assert.equal(res.status, 'succeeded');
  assert.equal(res.processor_transaction_id, 'AUTH-9921');
  assert.equal(res.metadata.recorded_outside_pos, true);
});

test('card tender without an integrated processor throws (no live processing)', () => {
  assert.throws(() => getPaymentAdapter('card'), PaymentError);
});

test('placeholder processor adapters throw on capture', async () => {
  const adapter = getPaymentAdapter('card', 'authorize_net');
  await assert.rejects(adapter.capture({ amount_cents: 1000 }), PaymentError);
});

test('isPhase1Tender only true for cash/manual_external/comp', () => {
  assert.equal(isPhase1Tender('cash'), true);
  assert.equal(isPhase1Tender('manual_external'), true);
  assert.equal(isPhase1Tender('comp'), true);
  assert.equal(isPhase1Tender('card'), false);
  assert.equal(isPhase1Tender('ach'), false);
});

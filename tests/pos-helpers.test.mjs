import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcLine,
  calcCart,
  validateTenderForCart,
  allowedTendersForCart,
  buildCanonicalCartItems,
  requiresAdminTender,
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

// ---------------------------------------------------------------------------
// Tender surface — comp is admin-only and not on the register; 'other' is gone
// ---------------------------------------------------------------------------
test("'other' tender no longer exists", () => {
  assert.equal(isValidTender('other'), false);
});

test('comp requires admin authorization; cash/card do not', () => {
  assert.equal(requiresAdminTender('comp'), true);
  assert.equal(requiresAdminTender('cash'), false);
  assert.equal(requiresAdminTender('manual_external'), false);
});

test('register never surfaces comp (admin-only) or removed tenders', () => {
  const tenders = allowedTendersForCart([{ price_cents: 100, quantity: 1 }]);
  const values = tenders.map((t) => t.value);
  assert.deepEqual(values.sort(), ['cash', 'manual_external']);
  assert.equal(values.includes('comp'), false);
  assert.equal(values.includes('other'), false);
});

// ---------------------------------------------------------------------------
// Server-owned cart assembly — canonical price/policy enforcement
// ---------------------------------------------------------------------------
const PID_A = '11111111-1111-1111-1111-111111111111';
const PID_B = '22222222-2222-2222-2222-222222222222';

const DB_PRODUCTS = [
  { id: PID_A, name: 'Coffee', sku: 'COF-1', price_cents: 400, tax_rate_bps: 825, taxable: true, active: true, restricted_tender_policy: 'none' },
  { id: PID_B, name: 'THCA Flower', sku: 'THCA-1', price_cents: 2000, tax_rate_bps: 0, taxable: false, active: true, restricted_tender_policy: 'cash_only' },
];

test('buildCanonicalCartItems uses DB price/tax/name, ignoring client values', () => {
  // Client tries to send a $0.01 price and a 'none' policy for the THCA item.
  const { items, error } = buildCanonicalCartItems(
    [{ product_id: PID_B, quantity: 2, price_cents: 1, tax_rate_bps: 0, name: 'Hacked', restricted_tender_policy: 'none' }],
    DB_PRODUCTS
  );
  assert.equal(error, null);
  assert.equal(items.length, 1);
  assert.equal(items[0].price_cents, 2000);          // canonical, not 1
  assert.equal(items[0].name, 'THCA Flower');         // canonical, not 'Hacked'
  assert.equal(items[0].restricted_tender_policy, 'cash_only'); // canonical, not 'none'
});

test('restricted-tender bypass attempt fails: client cannot relabel a cash_only item', () => {
  // Attacker submits product_id for the cash_only item but a forged 'none'
  // policy, then tries to pay by card. Canonical assembly + validation block it.
  const { items } = buildCanonicalCartItems(
    [{ product_id: PID_B, quantity: 1, restricted_tender_policy: 'none' }],
    DB_PRODUCTS
  );
  const check = validateTenderForCart(items, 'card');
  assert.equal(check.allowed, false);
  assert.match(check.reason, /THCA Flower/);
});

test('buildCanonicalCartItems rejects unknown product ids', () => {
  const { items, error } = buildCanonicalCartItems(
    [{ product_id: '99999999-9999-9999-9999-999999999999', quantity: 1 }],
    DB_PRODUCTS
  );
  assert.equal(items, null);
  assert.match(error, /Unknown product/);
});

test('buildCanonicalCartItems rejects inactive products', () => {
  const inactive = [{ ...DB_PRODUCTS[0], active: false }];
  const { items, error } = buildCanonicalCartItems([{ product_id: PID_A, quantity: 1 }], inactive);
  assert.equal(items, null);
  assert.match(error, /not available/);
});

test('buildCanonicalCartItems rejects non-positive quantity and missing id', () => {
  assert.match(buildCanonicalCartItems([{ product_id: PID_A, quantity: 0 }], DB_PRODUCTS).error, /positive quantity/);
  assert.match(buildCanonicalCartItems([{ quantity: 1 }], DB_PRODUCTS).error, /product_id/);
  assert.match(buildCanonicalCartItems([], DB_PRODUCTS).error, /empty/);
});

test('buildCanonicalCartItems totals match canonical DB calc', () => {
  const { items } = buildCanonicalCartItems(
    [{ product_id: PID_A, quantity: 3 }, { product_id: PID_B, quantity: 1 }],
    DB_PRODUCTS
  );
  const totals = calcCart(items);
  // Coffee: 400*3=1200 + tax 1200*0.0825=99 ; THCA: 2000 untaxed
  assert.equal(totals.subtotal_cents, 3200);
  assert.equal(totals.tax_cents, 99);
  assert.equal(totals.total_cents, 3299);
  assert.equal(totals.restricted_items_present, true);
});

// Tax-report aggregation: prove the portfolio-wide tax roll-up correctly
// sums collected + refunded tax across events, buckets by month, and ranks
// events by net tax owed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregateTaxReport } from '../lib/tickets/tax-report.js';

const evt1 = 'e1';
const evt2 = 'e2';
const titles = new Map([
  [evt1, { title: 'Ubiyu', event_date: '2026-09-18' }],
  [evt2, { title: 'Groove Therapy', event_date: '2026-10-15' }],
]);

test('empty input returns zeroed totals and empty breakdowns', () => {
  const r = aggregateTaxReport([], titles);
  assert.equal(r.totals.tax_collected_cents, 0);
  assert.equal(r.totals.tax_refunded_cents, 0);
  assert.equal(r.totals.net_tax_owed_cents, 0);
  assert.equal(r.totals.orders_count, 0);
  assert.deepEqual(r.by_month, []);
  assert.deepEqual(r.by_event, []);
});

test('single order shows up in totals, one month, one event', () => {
  const r = aggregateTaxReport([
    { event_id: evt1, status: 'paid', total_cents: 3026, tax_cents: 231, refunded_cents: 0, refunded_tax_cents: 0, paid_at: '2026-09-15T10:00:00Z' },
  ], titles);
  assert.equal(r.totals.tax_collected_cents, 231);
  assert.equal(r.totals.tax_refunded_cents, 0);
  assert.equal(r.totals.net_tax_owed_cents, 231);
  assert.equal(r.totals.orders_count, 1);
  assert.equal(r.by_month.length, 1);
  assert.deepEqual({ ...r.by_month[0] }, { month: '2026-09', tax_collected_cents: 231, tax_refunded_cents: 0, net_tax_owed_cents: 231, orders_count: 1 });
  assert.equal(r.by_event.length, 1);
  assert.equal(r.by_event[0].title, 'Ubiyu');
  assert.equal(r.by_event[0].net_tax_owed_cents, 231);
});

test('refunded tax subtracts from net owed', () => {
  const r = aggregateTaxReport([
    // Fully refunded order: tax collected AND refunded, net owed on this order = 0.
    { event_id: evt1, status: 'refunded', total_cents: 3026, tax_cents: 231, refunded_cents: 3026, refunded_tax_cents: 231, paid_at: '2026-09-10T00:00:00Z' },
    // Paid order untouched.
    { event_id: evt1, status: 'paid', total_cents: 3026, tax_cents: 231, refunded_cents: 0, refunded_tax_cents: 0, paid_at: '2026-09-20T00:00:00Z' },
  ], titles);
  assert.equal(r.totals.tax_collected_cents, 462);
  assert.equal(r.totals.tax_refunded_cents, 231);
  assert.equal(r.totals.net_tax_owed_cents, 231, 'the fully-refunded order zeroes itself out');
});

test('orders across two months bucket separately, sorted newest first', () => {
  const r = aggregateTaxReport([
    { event_id: evt1, status: 'paid', total_cents: 3026, tax_cents: 231, paid_at: '2026-08-25T00:00:00Z' },
    { event_id: evt1, status: 'paid', total_cents: 3026, tax_cents: 231, paid_at: '2026-09-05T00:00:00Z' },
    { event_id: evt2, status: 'paid', total_cents: 5000, tax_cents: 381, paid_at: '2026-09-25T00:00:00Z' },
  ], titles);
  assert.equal(r.by_month.length, 2);
  assert.equal(r.by_month[0].month, '2026-09', 'newest month first');
  assert.equal(r.by_month[0].tax_collected_cents, 231 + 381);
  assert.equal(r.by_month[0].orders_count, 2);
  assert.equal(r.by_month[1].month, '2026-08');
  assert.equal(r.by_month[1].tax_collected_cents, 231);
});

test('by_event ranks events by net tax owed (descending)', () => {
  const r = aggregateTaxReport([
    { event_id: evt1, status: 'paid', total_cents: 3026, tax_cents: 231, paid_at: '2026-09-01T00:00:00Z' },
    { event_id: evt2, status: 'paid', total_cents: 5000, tax_cents: 381, paid_at: '2026-09-02T00:00:00Z' },
    { event_id: evt2, status: 'paid', total_cents: 5000, tax_cents: 381, paid_at: '2026-09-03T00:00:00Z' },
  ], titles);
  assert.equal(r.by_event.length, 2);
  assert.equal(r.by_event[0].title, 'Groove Therapy', 'biggest tax-owed event ranks first');
  assert.equal(r.by_event[0].net_tax_owed_cents, 762);
  assert.equal(r.by_event[1].title, 'Ubiyu');
  assert.equal(r.by_event[1].net_tax_owed_cents, 231);
});

test('order with unknown event_id falls back to placeholder title', () => {
  const r = aggregateTaxReport([
    { event_id: 'ghost', status: 'paid', total_cents: 3026, tax_cents: 231, paid_at: '2026-09-01T00:00:00Z' },
  ], titles);
  assert.equal(r.by_event[0].title, '(unknown event)');
  assert.equal(r.by_event[0].event_id, 'ghost');
});

test('missing paid_at falls back to created_at for month bucketing', () => {
  const r = aggregateTaxReport([
    { event_id: evt1, status: 'paid', total_cents: 3026, tax_cents: 231, paid_at: null, created_at: '2026-07-04T00:00:00Z' },
  ], titles);
  assert.equal(r.by_month[0].month, '2026-07');
});

test('legacy untaxed order contributes to gross but zero to tax', () => {
  const r = aggregateTaxReport([
    { event_id: evt1, status: 'paid', total_cents: 2500, tax_cents: 0, paid_at: '2026-06-01T00:00:00Z' },
  ], titles);
  assert.equal(r.totals.gross_cents, 2500);
  assert.equal(r.totals.tax_collected_cents, 0);
  assert.equal(r.totals.net_tax_owed_cents, 0);
});

test('partial refund correctly reduces net owed but not tax collected', () => {
  const r = aggregateTaxReport([
    { event_id: evt1, status: 'partial_refund', total_cents: 3026, tax_cents: 231, refunded_cents: 1513, refunded_tax_cents: 116, paid_at: '2026-09-15T00:00:00Z' },
  ], titles);
  assert.equal(r.totals.tax_collected_cents, 231);
  assert.equal(r.totals.tax_refunded_cents, 116);
  assert.equal(r.totals.net_tax_owed_cents, 115);
  assert.equal(r.totals.refunded_cents, 1513);
});

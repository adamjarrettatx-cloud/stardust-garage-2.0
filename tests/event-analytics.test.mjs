import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  grossRevenueCents,
  totalFeesCents,
  netRevenueCents,
  ticketsSold,
  ticketsByType,
  sellThroughRate,
  projectFinalSales,
  summarizeEvent,
  centsToUsd,
  summarizeMemberCodes,
  groupCodesByEvent,
  buildEventAnalytics,
} from '../lib/event-analytics.js';

const orders = [
  { status: 'completed', total: 5000, total_payment_fee: 150, booking_fee: 50 },
  { status: 'completed', total: 2500, total_payment_fee: 75, booking_fee: 25 },
  { status: 'refunded',  total: 9999, total_payment_fee: 300, booking_fee: 0 },
];

const issued = [
  { status: 'valid', ticket_type_id: 'GA' },
  { status: 'valid', ticket_type_id: 'GA' },
  { status: 'valid', ticket_type_id: 'VIP' },
  { status: 'voided', ticket_type_id: 'GA' },
];

test('grossRevenueCents ignores refunded/cancelled', () => {
  assert.equal(grossRevenueCents(orders), 7500);
});

test('totalFeesCents sums payment + booking fees of valid orders', () => {
  assert.equal(totalFeesCents(orders), 150 + 50 + 75 + 25);
});

test('netRevenueCents = gross - fees', () => {
  assert.equal(netRevenueCents(orders), 7500 - 300);
});

test('ticketsSold excludes voided', () => {
  assert.equal(ticketsSold(issued), 3);
});

test('ticketsByType groups valid tickets', () => {
  assert.deepEqual(ticketsByType(issued), { GA: 2, VIP: 1 });
});

test('sellThroughRate handles unknown capacity', () => {
  assert.equal(sellThroughRate(issued, 0), null);
  assert.equal(sellThroughRate(issued, 6), 0.5);
});

test('projectFinalSales straight-lines and caps at capacity', () => {
  assert.equal(projectFinalSales({ soldSoFar: 10, daysElapsed: 5, daysTotal: 10 }), 20);
  assert.equal(projectFinalSales({ soldSoFar: 10, daysElapsed: 5, daysTotal: 10, capacity: 15 }), 15);
  assert.equal(projectFinalSales({ soldSoFar: 10, daysElapsed: 0, daysTotal: 10 }), 10);
});

test('summarizeEvent rolls up a coherent object', () => {
  const s = summarizeEvent({ orders, issuedTickets: issued, capacity: 6 });
  assert.equal(s.ticketsSold, 3);
  assert.equal(s.grossRevenueCents, 7500);
  assert.equal(s.netRevenueCents, 7200);
  assert.equal(s.sellThroughRate, 0.5);
});

test('centsToUsd formats and handles null', () => {
  assert.equal(centsToUsd(7500), '$75.00');
  assert.equal(centsToUsd(null), '—');
});

const memberCodes = [
  { event_id: 'e1', member_id: 'm1', discount_percent: 60, sent_at: '2026-01-01' },
  { event_id: 'e1', member_id: 'm2', discount_percent: 40, sent_at: null },
  { event_id: 'e2', member_id: 'm1', discount_percent: 50, sent_at: '2026-02-01' },
];

test('summarizeMemberCodes rolls up totals and average', () => {
  const s = summarizeMemberCodes(memberCodes.filter((c) => c.event_id === 'e1'));
  assert.equal(s.total, 2);
  assert.equal(s.sent, 1);
  assert.equal(s.pending, 1);
  assert.equal(s.avgDiscountPercent, 50);
});

test('summarizeMemberCodes handles empty', () => {
  assert.deepEqual(summarizeMemberCodes([]), { total: 0, sent: 0, pending: 0, avgDiscountPercent: null });
});

test('groupCodesByEvent buckets by event_id', () => {
  const g = groupCodesByEvent(memberCodes);
  assert.equal(g.e1.length, 2);
  assert.equal(g.e2.length, 1);
});

test('buildEventAnalytics joins events with codes and sorts by date desc', () => {
  const events = [
    { id: 'e1', title: 'Older', event_date: '2026-01-10', category: 'party', tt_event_series_id: 'ev_x', discount_codes_generated: true },
    { id: 'e2', title: 'Newer', event_date: '2026-02-10', category: 'yoga', tt_event_series_id: null, discount_codes_generated: false },
  ];
  const rows = buildEventAnalytics({ events, codes: memberCodes });
  assert.equal(rows[0].id, 'e2');
  assert.equal(rows[0].ttSeriesLinked, false);
  assert.equal(rows[1].id, 'e1');
  assert.equal(rows[1].memberCodes.total, 2);
  assert.equal(rows[1].ttSeriesLinked, true);
});

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
  normalizeCachedMetrics,
  buildEventPerformance,
  summarizePerformanceTotals,
  buildMetricsSnapshot,
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

// ---------------------------------------------------------------------------
// Cached metrics + performance rollup
// ---------------------------------------------------------------------------

test('normalizeCachedMetrics returns null for missing row', () => {
  assert.equal(normalizeCachedMetrics(null), null);
  assert.equal(normalizeCachedMetrics(undefined), null);
});

test('normalizeCachedMetrics normalizes an ok row and flags hasData', () => {
  const n = normalizeCachedMetrics({
    event_id: 'e1', tickets_sold: 12, orders_count: 9,
    gross_cents: 50000, fees_cents: 2000, net_cents: 48000,
    status: 'ok', source: 'tickettailor', fetched_at: '2026-06-15T00:00:00Z',
  });
  assert.equal(n.ticketsSold, 12);
  assert.equal(n.ordersCount, 9);
  assert.equal(n.netCents, 48000);
  assert.equal(n.hasData, true);
  assert.equal(n.attendeesCount, null);
});

test('normalizeCachedMetrics derives net when missing and treats not_configured as no data', () => {
  const derived = normalizeCachedMetrics({ tickets_sold: 5, gross_cents: 10000, fees_cents: 1000, net_cents: null, status: 'ok' });
  assert.equal(derived.netCents, 9000);
  const placeholder = normalizeCachedMetrics({ status: 'not_configured', gross_cents: 0, tickets_sold: 0 });
  assert.equal(placeholder.hasData, false);
});

test('buildEventPerformance joins events, codes, and metrics', () => {
  const events = [
    { id: 'e1', title: 'Party', event_date: '2026-01-10', category: 'party', tt_event_series_id: 'ev_x' },
    { id: 'e2', title: 'Yoga', event_date: '2026-02-10', category: 'yoga', tt_event_series_id: null },
  ];
  const metrics = [
    { event_id: 'e1', tickets_sold: 20, orders_count: 15, gross_cents: 100000, fees_cents: 5000, net_cents: 95000, status: 'ok' },
  ];
  const rows = buildEventPerformance({ events, codes: memberCodes, metrics });
  // Sorted date desc → e2 first.
  assert.equal(rows[0].id, 'e2');
  assert.equal(rows[0].metrics, null);
  assert.equal(rows[1].id, 'e1');
  assert.equal(rows[1].metrics.grossCents, 100000);
  assert.equal(rows[1].metrics.hasData, true);
});

test('summarizePerformanceTotals only sums revenue from rows with data', () => {
  const events = [
    { id: 'e1', title: 'A', event_date: '2026-01-10', tt_event_series_id: 'ev_x' },
    { id: 'e2', title: 'B', event_date: '2026-02-10', tt_event_series_id: null },
  ];
  const metrics = [
    { event_id: 'e1', tickets_sold: 20, orders_count: 15, gross_cents: 100000, fees_cents: 5000, net_cents: 95000, status: 'ok' },
    { event_id: 'e2', status: 'not_configured', gross_cents: 0, tickets_sold: 0 },
  ];
  const rows = buildEventPerformance({ events, codes: memberCodes, metrics });
  const t = summarizePerformanceTotals(rows);
  assert.equal(t.events, 2);
  assert.equal(t.ttLinked, 1);
  assert.equal(t.eventsWithMetrics, 1);
  assert.equal(t.grossCents, 100000);
  assert.equal(t.netCents, 95000);
  assert.equal(t.ticketsSold, 20);
  assert.equal(t.memberCodes, 3);
});

test('buildMetricsSnapshot builds an upsert-ready row from raw TT data', () => {
  const snap = buildMetricsSnapshot({
    eventId: 'e1', ttEventSeriesId: 'ev_x', orders, issuedTickets: issued,
    fetchedAt: '2026-06-15T00:00:00Z',
  });
  assert.equal(snap.event_id, 'e1');
  assert.equal(snap.tt_event_series_id, 'ev_x');
  assert.equal(snap.tickets_sold, 3);
  assert.equal(snap.gross_cents, 7500);
  assert.equal(snap.net_cents, 7200);
  assert.equal(snap.orders_count, 2); // refunded order excluded
  assert.equal(snap.status, 'ok');
  assert.equal(snap.source, 'tickettailor');
  assert.deepEqual(snap.raw_summary.ticketsByType, { GA: 2, VIP: 1 });
});

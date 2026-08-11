import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryNetCents, buildFinancialOverview } from '../lib/financial-overview.js';

const TODAY = new Date('2026-06-15T12:00:00Z');

// --- entryNetCents -----------------------------------------------------

test('entryNetCents: TT-only entry uses the stored (fee-deducted) net', () => {
  const e = { isManual: false, netCents: 95000, manualGrossCents: 0 };
  assert.equal(entryNetCents(e), 95000);
});

test('entryNetCents: manual-only entry has no fees, so gross IS net', () => {
  const e = { isManual: true, grossCents: 28000 };
  assert.equal(entryNetCents(e), 28000);
});

test('entryNetCents: combined entry adds manual gross back onto the TT-only net', () => {
  // attachManualIncomeToEvent never mutates netCents, so a combined entry's
  // netCents is still TT-only — the manual portion must be added back.
  const e = { isManual: false, netCents: 95000, manualGrossCents: 28000 };
  assert.equal(entryNetCents(e), 123000);
});

test('entryNetCents: missing/null fields default to 0 without throwing', () => {
  assert.equal(entryNetCents(null), 0);
  assert.equal(entryNetCents({ isManual: false, netCents: null, manualGrossCents: null }), 0);
});

// --- buildFinancialOverview ---------------------------------------------

const okMetrics = {
  event_id: 'e-ok', tickets_sold: 20, orders_count: 15,
  gross_cents: 100000, fees_cents: 5000, net_cents: 95000,
  status: 'ok', source: 'tickettailor', fetched_at: '2026-06-14T10:00:00Z',
};

test('buildFinancialOverview: totals include TT-discovered-only events and manual income (the original undercount bug)', () => {
  const events = [
    { id: 'e-ok', title: 'Gala', event_date: '2026-06-10', category: 'party', tt_event_series_id: 'ev_x' },
  ];
  const discovered = [{
    tt_event_series_id: 'es_feb', tt_event_id: 'ev_feb', title: 'Feb TT-only Party',
    event_date: '2026-02-14', gross_cents: 42000, fees_cents: 2000, net_cents: 40000,
    tickets_sold: 30, orders_count: 25, status: 'ok', source: 'tickettailor',
    fetched_at: '2026-07-20T00:00:00Z', local_event_id: null,
  }];
  const manual = [{
    id: 'm1', entry_date: '2026-03-01', title: 'Venue rental', category: 'venue_rental',
    amount_cents: 15000, local_event_id: null,
  }];

  const { totals } = buildFinancialOverview({ events, metrics: [okMetrics], discovered, manual, today: TODAY });

  // Old summarizePerformanceTotals() would have reported grossCents=100000
  // (local TT event only). The unified totals must include every source.
  assert.equal(totals.grossCents, 100000 + 42000 + 15000);
  assert.equal(totals.feesCents, 5000 + 2000);
  assert.equal(totals.netCents, 95000 + 40000 + 15000);
  assert.equal(totals.ticketsSold, 20 + 30);
  assert.equal(totals.ordersCount, 15 + 25);
  assert.equal(totals.revenueEntries, 3);
  assert.equal(totals.manualEntries, 1);
  // Only the one local website event counts toward `events`/`ttLinked`.
  assert.equal(totals.events, 1);
  assert.equal(totals.ttLinked, 1);
});

test('buildFinancialOverview: manual income folded onto a local event is counted once, not twice', () => {
  const events = [
    { id: 'e-ok', title: 'Gala', event_date: '2026-06-10', category: 'party', tt_event_series_id: 'ev_x' },
  ];
  const manual = [{
    id: 'm1', entry_date: '2026-06-10', title: 'Extra rental fee', category: 'venue_rental',
    amount_cents: 5000, local_event_id: 'e-ok',
  }];

  const { entries, totals, performanceRows } = buildFinancialOverview({
    events, metrics: [okMetrics], manual, today: TODAY,
  });

  // Folded manual income does not create a second entry.
  assert.equal(entries.length, 1);
  assert.equal(entries[0].grossCents, 105000); // 100000 TT + 5000 manual
  assert.equal(entries[0].netCents, 95000); // untouched TT net
  assert.equal(entries[0].manualGrossCents, 5000);
  assert.equal(entryNetCents(entries[0]), 100000); // 95000 + 5000

  assert.equal(totals.grossCents, 105000);
  assert.equal(totals.netCents, 100000);
  assert.equal(totals.manualEntries, 1);

  // The folded event still appears exactly once in the performance table.
  assert.equal(performanceRows.length, 1);
  assert.equal(performanceRows[0].id, 'e-ok');
});

test('buildFinancialOverview: performanceRows excludes TT-discovered-only and standalone manual entries', () => {
  const events = [
    { id: 'e-ok', title: 'Gala', event_date: '2026-06-10', category: 'party', tt_event_series_id: 'ev_x' },
  ];
  const discovered = [{
    tt_event_series_id: 'es_feb', tt_event_id: 'ev_feb', title: 'Feb TT-only Party',
    event_date: '2026-02-14', gross_cents: 42000, fees_cents: 2000, net_cents: 40000,
    tickets_sold: 30, orders_count: 25, status: 'ok', source: 'tickettailor',
    fetched_at: '2026-07-20T00:00:00Z', local_event_id: null,
  }];
  const manual = [{
    id: 'm1', entry_date: '2026-03-01', title: 'Venue rental', category: 'venue_rental',
    amount_cents: 15000, local_event_id: null,
  }];

  const { entries, performanceRows } = buildFinancialOverview({
    events, metrics: [okMetrics], discovered, manual, today: TODAY,
  });

  assert.equal(entries.length, 3); // calendar view sees all three
  assert.equal(performanceRows.length, 1); // performance table sees only the local event
  assert.equal(performanceRows[0].id, 'e-ok');
});

test('buildFinancialOverview: attaches member-code engagement only to local, non-manual entries', () => {
  const events = [
    { id: 'e-ok', title: 'Gala', event_date: '2026-06-10', category: 'party', tt_event_series_id: 'ev_x' },
  ];
  const codes = [
    { event_id: 'e-ok', member_id: 'mem1', discount_percent: 20, sent_at: '2026-06-01T00:00:00Z' },
    { event_id: 'e-ok', member_id: 'mem2', discount_percent: 20, sent_at: null },
  ];
  const discovered = [{
    tt_event_series_id: 'es_feb', tt_event_id: 'ev_feb', title: 'Feb TT-only Party',
    event_date: '2026-02-14', gross_cents: 0, fees_cents: 0, net_cents: 0,
    tickets_sold: 0, orders_count: 0, status: 'ok', source: 'tickettailor',
    fetched_at: null, local_event_id: null,
  }];

  const { entries, performanceRows, totals } = buildFinancialOverview({
    events, metrics: [okMetrics], discovered, codes, today: TODAY,
  });

  const local = entries.find((e) => e.id === 'e-ok');
  const disc = entries.find((e) => e.id === 'tt:es_feb');
  assert.deepEqual(local.memberCodes, { total: 2, sent: 1, pending: 1, avgDiscountPercent: 20 });
  assert.equal(disc.memberCodes, undefined);

  assert.equal(performanceRows[0].memberCodes.total, 2);
  assert.equal(totals.memberCodes, 2);
  assert.equal(totals.codesSent, 1);
});

test('buildFinancialOverview: empty input produces all-zero totals without throwing', () => {
  const { entries, performanceRows, totals } = buildFinancialOverview({});
  assert.deepEqual(entries, []);
  assert.deepEqual(performanceRows, []);
  assert.equal(totals.grossCents, 0);
  assert.equal(totals.netCents, 0);
  assert.equal(totals.events, 0);
  assert.equal(totals.revenueEntries, 0);
  assert.equal(totals.lastUpdated, null);
});

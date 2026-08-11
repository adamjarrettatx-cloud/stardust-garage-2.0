import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  entryNetCents,
  buildFinancialOverview,
  summarizePosByDay,
  buildDailyRevenue,
  isoWeekKey,
  rollupDailyRevenue,
} from '../lib/financial-overview.js';
import { normalizeTransaction } from '../lib/financial-ledger.js';

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

// --- summarizePosByDay / buildDailyRevenue / rollupDailyRevenue --------
// (the "every dollar, every day" tracking added for weekday-only POS income)

function posRow({ date, amount, direction = 'in', category = 'POS Revenue', source = 'spoton_csv' }) {
  return normalizeTransaction({
    id: `${date}-${direction}-${Math.random()}`,
    transaction_date: date,
    amount,
    direction,
    txn_type: 'operating',
    category,
    source,
  });
}

test('summarizePosByDay: sums SpotOn revenue and refunds per day, ignores other sources', () => {
  const transactions = [
    posRow({ date: '2026-06-10', amount: '400.00' }),
    posRow({ date: '2026-06-10', amount: '25.00', direction: 'out', category: 'POS Refunds' }),
    posRow({ date: '2026-06-11', amount: '150.50' }),
    normalizeTransaction({ id: 'tt1', transaction_date: '2026-06-10', amount: '999.00', direction: 'in', txn_type: 'operating', category: 'Ticket Revenue', source: 'tickettailor' }),
  ];
  const byDay = summarizePosByDay(transactions);
  assert.equal(byDay.size, 2);
  assert.deepEqual(byDay.get('2026-06-10'), { date: '2026-06-10', revenueCents: 40000, refundCents: 2500 });
  assert.deepEqual(byDay.get('2026-06-11'), { date: '2026-06-11', revenueCents: 15050, refundCents: 0 });
});

test('summarizePosByDay: a re-import or a same-day revenue+refund row both accumulate rather than overwrite', () => {
  const transactions = [
    posRow({ date: '2026-06-10', amount: '100.00' }),
    posRow({ date: '2026-06-10', amount: '50.00' }),
  ];
  const byDay = summarizePosByDay(transactions);
  assert.equal(byDay.get('2026-06-10').revenueCents, 15000);
});

test('buildDailyRevenue: a weekday with only POS activity and no event still produces a day row, with hasEvent=false', () => {
  const posTransactions = [posRow({ date: '2026-06-03', amount: '620.00' })];
  const rows = buildDailyRevenue({ entries: [], posTransactions });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-06-03');
  assert.equal(rows[0].hasEvent, false);
  assert.equal(rows[0].posRevenueCents, 62000);
  assert.equal(rows[0].eventGrossCents, 0);
  assert.equal(rows[0].totalGrossCents, 62000);
  assert.equal(rows[0].totalNetCents, 62000);
});

test('buildDailyRevenue: an event day combines with same-day POS sales into one row, and a standalone manual entry does not count as an event', () => {
  const events = [
    { id: 'e-ok', title: 'Gala', event_date: '2026-06-10', category: 'party', tt_event_series_id: 'ev_x' },
  ];
  const manual = [{
    id: 'm-standalone', entry_date: '2026-06-10', title: 'Photo booth fee', category: 'other',
    amount_cents: 3000, local_event_id: null,
  }];
  const { entries } = buildFinancialOverview({ events, metrics: [okMetrics], manual, today: TODAY });
  const posTransactions = [posRow({ date: '2026-06-10', amount: '80.00' })];

  const rows = buildDailyRevenue({ entries, posTransactions });
  assert.equal(rows.length, 1);
  const day = rows[0];
  assert.equal(day.hasEvent, true); // the Gala is a real event
  assert.equal(day.eventGrossCents, 100000 + 3000); // TT gross + standalone manual
  assert.equal(day.eventNetCents, 95000 + 3000);
  assert.equal(day.posRevenueCents, 8000);
  assert.equal(day.totalGrossCents, 100000 + 3000 + 8000);
  assert.equal(day.totalNetCents, 95000 + 3000 + 8000);
  assert.equal(day.entries.length, 2); // the Gala + the standalone manual entry
});

test('buildDailyRevenue: a day with only a standalone manual entry (no event, no POS) still has hasEvent=false', () => {
  const manual = [{
    id: 'm1', entry_date: '2026-07-01', title: 'Venue rental', category: 'venue_rental',
    amount_cents: 15000, local_event_id: null,
  }];
  const { entries } = buildFinancialOverview({ manual, today: TODAY });
  const rows = buildDailyRevenue({ entries, posTransactions: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].hasEvent, false);
  assert.equal(rows[0].totalGrossCents, 15000);
});

test('buildDailyRevenue: empty input produces an empty array without throwing', () => {
  assert.deepEqual(buildDailyRevenue({}), []);
});

test('isoWeekKey: Monday-start ISO week matches known reference dates', () => {
  // 2026-06-10 is a Wednesday; ISO week 24 of 2026 runs Mon Jun 8 - Sun Jun 14.
  assert.equal(isoWeekKey('2026-06-08'), '2026-W24');
  assert.equal(isoWeekKey('2026-06-10'), '2026-W24');
  assert.equal(isoWeekKey('2026-06-14'), '2026-W24');
  assert.equal(isoWeekKey('2026-06-15'), '2026-W25');
  // Dec 31 2025 (Wednesday) falls in the same ISO week as Jan 1 2026 — an
  // ISO week can straddle a calendar-year boundary, and the key must use the
  // ISO year (2026, via the week's Thursday), not the raw calendar year.
  assert.equal(isoWeekKey('2025-12-31'), isoWeekKey('2026-01-01'));
});

test('rollupDailyRevenue: day granularity is a labeled passthrough, one bucket per row', () => {
  const posTransactions = [posRow({ date: '2026-06-10', amount: '100.00' }), posRow({ date: '2026-06-11', amount: '50.00' })];
  const daily = buildDailyRevenue({ entries: [], posTransactions });
  const rolled = rollupDailyRevenue(daily, 'day');
  assert.equal(rolled.length, 2);
  assert.equal(rolled[0].key, '2026-06-10');
  assert.equal(rolled[0].totalGrossCents, 10000);
  assert.equal(rolled[1].key, '2026-06-11');
});

test('rollupDailyRevenue: week granularity sums every day in the same ISO week into one bucket', () => {
  const posTransactions = [
    posRow({ date: '2026-06-08', amount: '100.00' }), // Mon, week 24
    posRow({ date: '2026-06-10', amount: '200.00' }), // Wed, week 24
    posRow({ date: '2026-06-15', amount: '50.00' }),  // Mon, week 25
  ];
  const daily = buildDailyRevenue({ entries: [], posTransactions });
  const rolled = rollupDailyRevenue(daily, 'week');
  assert.equal(rolled.length, 2);
  assert.equal(rolled[0].key, '2026-W24');
  assert.equal(rolled[0].days, 2);
  assert.equal(rolled[0].totalGrossCents, 30000);
  assert.equal(rolled[1].key, '2026-W25');
  assert.equal(rolled[1].totalGrossCents, 5000);
});

test('rollupDailyRevenue: month granularity sums every day in the same calendar month, and hasEvent propagates if any day in the bucket has one', () => {
  const events = [
    { id: 'e-ok', title: 'Gala', event_date: '2026-06-10', category: 'party', tt_event_series_id: 'ev_x' },
  ];
  const { entries } = buildFinancialOverview({ events, metrics: [okMetrics], today: TODAY });
  const posTransactions = [
    posRow({ date: '2026-06-03', amount: '60.00' }),
    posRow({ date: '2026-06-25', amount: '40.00' }),
    posRow({ date: '2026-07-01', amount: '10.00' }),
  ];
  const daily = buildDailyRevenue({ entries, posTransactions });
  const rolled = rollupDailyRevenue(daily, 'month');
  assert.equal(rolled.length, 2);
  const june = rolled.find((r) => r.key === '2026-06');
  assert.equal(june.label, 'Jun 2026');
  assert.equal(june.days, 3); // Jun 3, Jun 10 (event), Jun 25
  assert.equal(june.hasEvent, true);
  assert.equal(june.totalGrossCents, 6000 + 100000 + 4000);
  const july = rolled.find((r) => r.key === '2026-07');
  assert.equal(july.hasEvent, false);
  assert.equal(july.totalGrossCents, 1000);
});

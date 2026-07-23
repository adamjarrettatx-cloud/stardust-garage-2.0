import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTRY_STATE,
  mergeIncomeSources,
  buildIncomeEntry,
  buildFinancialCalendar,
  entriesInMonth,
  summarizeIncome,
} from '../lib/financial-calendar.js';

const TODAY = new Date('2026-06-15T12:00:00Z');

const okMetrics = {
  event_id: 'e-ok', tickets_sold: 20, orders_count: 15,
  gross_cents: 100000, fees_cents: 5000, net_cents: 95000,
  status: 'ok', source: 'tickettailor', fetched_at: '2026-06-14T10:00:00Z',
};

test('mergeIncomeSources adds gross/tickets/orders across sources', () => {
  const merged = mergeIncomeSources([
    { source: 'tickettailor', grossCents: 100000, ticketsSold: 20, ordersCount: 15 },
    { source: 'spoton', grossCents: 5000, ticketsSold: 0, ordersCount: 3 },
  ]);
  assert.deepEqual(merged, { grossCents: 105000, ticketsSold: 20, ordersCount: 18 });
});

test('mergeIncomeSources tolerates empty/nullish input', () => {
  assert.deepEqual(mergeIncomeSources(), { grossCents: 0, ticketsSold: 0, ordersCount: 0 });
  assert.deepEqual(mergeIncomeSources([null, undefined]), { grossCents: 0, ticketsSold: 0, ordersCount: 0 });
});

test('buildIncomeEntry: ok row exposes income and OK state', () => {
  const e = buildIncomeEntry(
    { id: 'e-ok', title: 'Gala', event_date: '2026-06-10', category: 'party', status: 'published', tt_event_series_id: 'ev_x' },
    okMetrics,
    TODAY,
  );
  assert.equal(e.state, ENTRY_STATE.OK);
  assert.equal(e.hasIncome, true);
  assert.equal(e.grossCents, 100000);
  assert.equal(e.netCents, 95000);
  assert.equal(e.ticketsSold, 20);
  assert.equal(e.ordersCount, 15);
  assert.equal(e.isFuture, false);
  assert.equal(e.fetchedAt, '2026-06-14T10:00:00Z');
});

test('buildIncomeEntry: unlinked event has no metrics and UNLINKED state', () => {
  const e = buildIncomeEntry(
    { id: 'e2', title: 'Yoga', event_date: '2026-06-20', tt_event_series_id: null },
    undefined,
    TODAY,
  );
  assert.equal(e.state, ENTRY_STATE.UNLINKED);
  assert.equal(e.ttLinked, false);
  assert.equal(e.hasIncome, false);
  assert.equal(e.grossCents, 0);
  assert.equal(e.netCents, null);
});

test('buildIncomeEntry: linked but never refreshed is PENDING', () => {
  const e = buildIncomeEntry(
    { id: 'e3', title: 'TBD', event_date: '2026-06-05', tt_event_series_id: 'ev_y' },
    undefined,
    TODAY,
  );
  assert.equal(e.state, ENTRY_STATE.PENDING);
  assert.equal(e.hasIncome, false);
});

test('buildIncomeEntry: refreshed with zero sales is ZERO, not OK', () => {
  const e = buildIncomeEntry(
    { id: 'e4', title: 'Slow', event_date: '2026-06-05', tt_event_series_id: 'ev_z' },
    { event_id: 'e4', status: 'ok', gross_cents: 0, tickets_sold: 0, net_cents: 0 },
    TODAY,
  );
  assert.equal(e.state, ENTRY_STATE.ZERO);
  assert.equal(e.hasIncome, false);
  assert.equal(e.grossCents, 0);
});

test('buildIncomeEntry: not_configured and error states surface distinctly', () => {
  const nc = buildIncomeEntry(
    { id: 'e5', title: 'NC', event_date: '2026-06-05', tt_event_series_id: 'ev_a' },
    { event_id: 'e5', status: 'not_configured', gross_cents: 0, tickets_sold: 0 },
    TODAY,
  );
  assert.equal(nc.state, ENTRY_STATE.NOT_CONFIGURED);
  const err = buildIncomeEntry(
    { id: 'e6', title: 'Err', event_date: '2026-06-05', tt_event_series_id: 'ev_b' },
    { event_id: 'e6', status: 'error', gross_cents: 0, tickets_sold: 0 },
    TODAY,
  );
  assert.equal(err.state, ENTRY_STATE.ERROR);
});

test('buildIncomeEntry: future event flagged isFuture (sales-to-date, no forecast)', () => {
  const e = buildIncomeEntry(
    { id: 'e-fut', title: 'Future Fest', event_date: '2026-08-01', tt_event_series_id: 'ev_f' },
    { event_id: 'e-fut', status: 'ok', gross_cents: 3000, tickets_sold: 2, orders_count: 2, net_cents: 2800 },
    TODAY,
  );
  assert.equal(e.isFuture, true);
  // Only actual sales-to-date — no projection is applied.
  assert.equal(e.grossCents, 3000);
  assert.equal(e.hasIncome, true);
});

test('buildFinancialCalendar joins events with metrics and sorts by date asc', () => {
  const events = [
    { id: 'e-ok', title: 'Gala', event_date: '2026-06-10', tt_event_series_id: 'ev_x' },
    { id: 'e2', title: 'Yoga', event_date: '2026-05-01', tt_event_series_id: null },
  ];
  const entries = buildFinancialCalendar({ events, metrics: [okMetrics], today: TODAY });
  assert.equal(entries[0].id, 'e2'); // earlier date first
  assert.equal(entries[1].id, 'e-ok');
  assert.equal(entries[1].grossCents, 100000);
});

test('entriesInMonth filters by year+month (0-indexed)', () => {
  const entries = [
    { id: 'a', eventDate: '2026-06-10' },
    { id: 'b', eventDate: '2026-07-01' },
    { id: 'c', eventDate: '2026-06-30' },
    { id: 'd', eventDate: null },
  ];
  const june = entriesInMonth(entries, 2026, 5);
  assert.deepEqual(june.map((e) => e.id), ['a', 'c']);
});

test('summarizeIncome only counts entries with real income and tracks lastUpdated', () => {
  const events = [
    { id: 'e-ok', title: 'Gala', event_date: '2026-06-10', tt_event_series_id: 'ev_x' },
    { id: 'e-zero', title: 'Slow', event_date: '2026-06-12', tt_event_series_id: 'ev_z' },
    { id: 'e-unlinked', title: 'Yoga', event_date: '2026-06-14', tt_event_series_id: null },
  ];
  const metrics = [
    okMetrics,
    { event_id: 'e-zero', status: 'ok', gross_cents: 0, tickets_sold: 0, net_cents: 0, fetched_at: '2026-06-15T09:00:00Z' },
  ];
  const entries = buildFinancialCalendar({ events, metrics, today: TODAY });
  const s = summarizeIncome(entries);
  assert.equal(s.eventCount, 3);
  assert.equal(s.revenueEvents, 1);
  assert.equal(s.grossCents, 100000);
  assert.equal(s.ticketsSold, 20);
  assert.equal(s.ordersCount, 15);
  // Latest fetched_at across contributing rows.
  assert.equal(s.lastUpdated, '2026-06-15T09:00:00Z');
});

test('summarizeIncome on empty set is all zeros', () => {
  assert.deepEqual(summarizeIncome([]), {
    eventCount: 0, revenueEvents: 0, grossCents: 0, ticketsSold: 0, ordersCount: 0, lastUpdated: null,
  });
});

// Regression: every month that has events must be representable as entries and
// isolable by entriesInMonth. The original bug surfaced when the page query
// capped the event set, so whole months (e.g. Feb/Mar/Apr) rendered empty. The
// pure pipeline must never drop a month given the full event set.
test('buildFinancialCalendar + entriesInMonth covers every month incl. Feb/Mar/Apr', () => {
  const events = Array.from({ length: 12 }, (_, i) => ({
    id: `e-${i + 1}`,
    title: `Event ${i + 1}`,
    event_date: `2026-${String(i + 1).padStart(2, '0')}-15`,
    tt_event_series_id: null,
  }));
  const entries = buildFinancialCalendar({ events, metrics: [], today: TODAY });
  assert.equal(entries.length, 12);
  // month is 0-indexed: Feb=1, Mar=2, Apr=3.
  for (const month of [1, 2, 3]) {
    const inMonth = entriesInMonth(entries, 2026, month);
    assert.equal(inMonth.length, 1, `expected one entry for 2026 month ${month}`);
    assert.equal(inMonth[0].eventDate, `2026-${String(month + 1).padStart(2, '0')}-15`);
  }
});

// Regression: event_date may arrive as a full timestamptz string, not a bare
// date. toDateString() must reduce it to YYYY-MM-DD so month filtering still
// buckets it into the correct month rather than dropping it.
test('entriesInMonth buckets timestamp-format event_date into the right month', () => {
  const events = [
    { id: 'ts-feb', title: 'Feb', event_date: '2026-02-15T00:00:00+00:00', tt_event_series_id: null },
    { id: 'ts-apr', title: 'Apr', event_date: '2026-04-01T18:30:00.000Z', tt_event_series_id: null },
  ];
  const entries = buildFinancialCalendar({ events, metrics: [], today: TODAY });
  assert.deepEqual(entriesInMonth(entries, 2026, 1).map((e) => e.id), ['ts-feb']);
  assert.deepEqual(entriesInMonth(entries, 2026, 3).map((e) => e.id), ['ts-apr']);
});

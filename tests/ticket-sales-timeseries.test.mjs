import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRANULARITIES,
  DEFAULT_BUCKET_COUNT,
  venueDateString,
  startOfIsoWeek,
  bucketKey,
  orderSaleInstantMs,
  buildSalesSeries,
  buildAllSalesSeries,
  earliestWindowStartIso,
  summarizeSeries,
} from '../lib/ticket-sales-timeseries.js';

// The suite runs under TZ=UTC (see package.json), so any venue-local behavior
// proven here is genuinely coming from the America/Chicago formatting and not
// from the host clock happening to agree.

const NOW = new Date('2026-07-15T12:00:00Z'); // Wed 15 Jul 2026, 07:00 in Austin

// Helper: a completed order placed at an exact instant.
const order = (iso, cents, status = 'completed') => ({
  total_paid_cents: cents,
  status,
  created_at: iso,
});

test('venueDateString uses Austin day boundaries, not UTC', () => {
  // 02:30Z on Jul 16 is still 21:30 on Jul 15 in Austin (CDT, UTC-5).
  assert.equal(venueDateString(Date.parse('2026-07-16T02:30:00Z')), '2026-07-15');
  // 05:30Z is 00:30 on Jul 16 in Austin — the venue day has rolled over.
  assert.equal(venueDateString(Date.parse('2026-07-16T05:30:00Z')), '2026-07-16');
});

test('venueDateString honors CST (UTC-6) outside daylight saving', () => {
  // 03:30Z on Jan 16 is 21:30 Jan 15 in Austin during CST.
  assert.equal(venueDateString(Date.parse('2026-01-16T03:30:00Z')), '2026-01-15');
  assert.equal(venueDateString(Date.parse('2026-01-16T06:30:00Z')), '2026-01-16');
});

test('startOfIsoWeek snaps to Monday, not Sunday', () => {
  assert.equal(startOfIsoWeek('2026-07-15'), '2026-07-13'); // Wed -> Mon
  assert.equal(startOfIsoWeek('2026-07-13'), '2026-07-13'); // Mon -> itself
  // Sunday belongs to the week that STARTED on the previous Monday. A
  // Sunday-start implementation would wrongly return 2026-07-19 here.
  assert.equal(startOfIsoWeek('2026-07-19'), '2026-07-13');
  assert.equal(startOfIsoWeek('2026-07-20'), '2026-07-20'); // next Mon
});

test('startOfIsoWeek crosses month and year boundaries', () => {
  assert.equal(startOfIsoWeek('2026-01-01'), '2025-12-29'); // Thu -> prev Mon
  assert.equal(startOfIsoWeek('2026-03-01'), '2026-02-23'); // Sun -> prev Mon
});

test('bucketKey maps a date to day / ISO week / month keys', () => {
  assert.equal(bucketKey('2026-07-15', 'day'), '2026-07-15');
  assert.equal(bucketKey('2026-07-15', 'week'), '2026-07-13');
  assert.equal(bucketKey('2026-07-15', 'month'), '2026-07');
});

test('orderSaleInstantMs prefers the TicketTailor timestamp over the row insert time', () => {
  const ttSeconds = Math.floor(Date.parse('2026-07-10T15:00:00Z') / 1000);
  assert.equal(
    orderSaleInstantMs({ tt_created_at: String(ttSeconds), created_at: '2026-07-14T00:00:00Z' }),
    ttSeconds * 1000,
  );
  // Nested raw_payload shape works too, for callers holding a full row.
  assert.equal(
    orderSaleInstantMs({ raw_payload: { created_at: ttSeconds }, created_at: '2026-07-14T00:00:00Z' }),
    ttSeconds * 1000,
  );
});

test('orderSaleInstantMs falls back to created_at and rejects junk', () => {
  assert.equal(orderSaleInstantMs({ created_at: '2026-07-14T00:00:00Z' }), Date.parse('2026-07-14T00:00:00Z'));
  assert.equal(orderSaleInstantMs({ tt_created_at: 'nope', created_at: '2026-07-14T00:00:00Z' }), Date.parse('2026-07-14T00:00:00Z'));
  assert.equal(orderSaleInstantMs({ created_at: 'not-a-date' }), null);
  assert.equal(orderSaleInstantMs({}), null);
  assert.equal(orderSaleInstantMs(null), null);
});

test('buildSalesSeries returns a full trailing window ending at today', () => {
  const series = buildSalesSeries({ orders: [], granularity: 'day', now: NOW });
  assert.equal(series.length, DEFAULT_BUCKET_COUNT.day);
  assert.equal(series.at(-1).key, '2026-07-15');
  assert.equal(series[0].key, '2026-06-16'); // 30 days inclusive
  // Empty buckets are present and zeroed rather than omitted.
  assert.deepEqual(series[0], {
    key: '2026-06-16',
    startDate: '2026-06-16',
    label: '6/16',
    tooltipLabel: 'Tue, Jun 16, 2026',
    grossCents: 0,
    ordersCount: 0,
  });
});

test('buildSalesSeries sums completed orders into their venue-local day', () => {
  const series = buildSalesSeries({
    orders: [
      order('2026-07-15T14:00:00Z', 2500),
      order('2026-07-15T20:00:00Z', 1000),
      // 02:00Z Jul 16 is 21:00 Jul 15 in Austin — must land on the 15th.
      order('2026-07-16T02:00:00Z', 4000),
    ],
    granularity: 'day',
    now: NOW,
  });

  const jul15 = series.find((b) => b.key === '2026-07-15');
  assert.equal(jul15.grossCents, 7500);
  assert.equal(jul15.ordersCount, 3);
  assert.equal(summarizeSeries(series).grossCents, 7500);
});

test('buildSalesSeries ignores non-completed orders', () => {
  const series = buildSalesSeries({
    orders: [
      order('2026-07-15T14:00:00Z', 2500, 'pending'),
      order('2026-07-15T14:00:00Z', 9900, 'canceled'),
      order('2026-07-15T14:00:00Z', 100, 'COMPLETED'), // case-insensitive
    ],
    granularity: 'day',
    now: NOW,
  });
  const jul15 = series.find((b) => b.key === '2026-07-15');
  assert.equal(jul15.grossCents, 100);
  assert.equal(jul15.ordersCount, 1);
});

test('buildSalesSeries drops orders outside the window instead of skewing edges', () => {
  const series = buildSalesSeries({
    orders: [
      order('2026-01-05T14:00:00Z', 50000), // long before the 30-day window
      order('2026-07-15T14:00:00Z', 700),
    ],
    granularity: 'day',
    now: NOW,
  });
  assert.equal(summarizeSeries(series).grossCents, 700);
  assert.equal(series[0].grossCents, 0);
});

test('buildSalesSeries groups by Monday-start weeks', () => {
  const series = buildSalesSeries({
    orders: [
      order('2026-07-13T14:00:00Z', 1000), // Mon
      order('2026-07-19T14:00:00Z', 2000), // Sun — same ISO week
      order('2026-07-20T14:00:00Z', 4000), // next Mon — next bucket
    ],
    granularity: 'week',
    now: new Date('2026-07-22T12:00:00Z'),
  });

  assert.equal(series.length, DEFAULT_BUCKET_COUNT.week);
  const wk13 = series.find((b) => b.key === '2026-07-13');
  const wk20 = series.find((b) => b.key === '2026-07-20');
  assert.equal(wk13.grossCents, 3000);
  assert.equal(wk13.ordersCount, 2);
  assert.equal(wk20.grossCents, 4000);
  assert.match(wk13.tooltipLabel, /^Week of Jul 13, 2026 \(Mon\)/);
});

test('buildSalesSeries groups by calendar month', () => {
  const series = buildSalesSeries({
    orders: [
      order('2026-06-30T14:00:00Z', 1000),
      order('2026-07-01T14:00:00Z', 2000),
      order('2026-07-15T14:00:00Z', 3000),
    ],
    granularity: 'month',
    now: NOW,
  });

  assert.equal(series.length, DEFAULT_BUCKET_COUNT.month);
  assert.equal(series.at(-1).key, '2026-07');
  assert.equal(series[0].key, '2025-08');
  assert.equal(series.find((b) => b.key === '2026-06').grossCents, 1000);
  const jul = series.find((b) => b.key === '2026-07');
  assert.equal(jul.grossCents, 5000);
  assert.equal(jul.startDate, '2026-07-01');
  assert.equal(jul.tooltipLabel, 'July 2026');
});

test('buildSalesSeries tolerates missing/negative amounts', () => {
  const series = buildSalesSeries({
    orders: [
      { status: 'completed', created_at: '2026-07-15T14:00:00Z' },
      { status: 'completed', created_at: '2026-07-15T14:00:00Z', total_paid_cents: null },
      { status: 'completed', created_at: '2026-07-15T14:00:00Z', total_paid_cents: -500 },
      { status: 'completed', created_at: '2026-07-15T14:00:00Z', total_paid_cents: '250' },
      null,
    ],
    granularity: 'day',
    now: NOW,
  });
  const jul15 = series.find((b) => b.key === '2026-07-15');
  assert.equal(jul15.grossCents, 250);
  assert.equal(jul15.ordersCount, 4);
});

test('buildSalesSeries rejects an unknown granularity', () => {
  assert.throws(() => buildSalesSeries({ granularity: 'quarter', now: NOW }), /unknown granularity/);
});

test('buildAllSalesSeries precomputes every granularity from one order set', () => {
  const all = buildAllSalesSeries({ orders: [order('2026-07-15T14:00:00Z', 1500)], now: NOW });
  assert.deepEqual(Object.keys(all).sort(), [...GRANULARITIES].sort());
  for (const g of GRANULARITIES) {
    assert.equal(all[g].length, DEFAULT_BUCKET_COUNT[g]);
    assert.equal(summarizeSeries(all[g]).grossCents, 1500);
  }
});

test('earliestWindowStartIso covers the widest default window', () => {
  const iso = earliestWindowStartIso(NOW);
  // 12 months back from Jul 2026 is Aug 2025; the helper pads a day earlier.
  assert.equal(iso, '2025-07-31T00:00:00.000Z');
  // Every default window must start at or after this bound.
  for (const g of GRANULARITIES) {
    const first = buildSalesSeries({ granularity: g, now: NOW })[0].startDate;
    assert.ok(Date.parse(`${first}T00:00:00Z`) >= Date.parse(iso), `${g} window starts before the query bound`);
  }
});

test('summarizeSeries totals gross and order counts', () => {
  assert.deepEqual(
    summarizeSeries([
      { grossCents: 100, ordersCount: 1 },
      { grossCents: 250, ordersCount: 3 },
    ]),
    { grossCents: 350, ordersCount: 4 },
  );
  assert.deepEqual(summarizeSeries([]), { grossCents: 0, ordersCount: 0 });
});

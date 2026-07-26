import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRANULARITIES,
  DEFAULT_BUCKET_COUNT,
  SALES_DATA_START_DATE,
  floorBucketKey,
  venueDateString,
  startOfIsoWeek,
  bucketKey,
  orderSaleInstantMs,
  buildSalesSeries,
  buildAllSalesSeries,
  earliestWindowStartIso,
  fetchAllOrderPages,
  ORDER_PAGE_SIZE,
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

// ---------------------------------------------------------------------------
// The exact row shape the analytics page reads. `raw_payload->>created_at` is a
// PostgREST text extraction, so TicketTailor's unix-SECONDS timestamp arrives as
// a NUMERIC STRING ('1785013826'), never an ISO date — `new Date()` on that
// string is Invalid Date, so it has to go through Number() * 1000.
// ---------------------------------------------------------------------------

// A row as `select(...tt_created_at:raw_payload->>created_at)` returns it: the
// TT instant as an epoch-seconds string, and our own insert time as ISO.
const dbRow = (ttCreatedAtSeconds, cents, rowCreatedAtIso, status = 'completed') => ({
  total_paid_cents: cents,
  status,
  created_at: rowCreatedAtIso,
  tt_created_at: String(ttCreatedAtSeconds),
});

test('an epoch-seconds string tt_created_at resolves to the right instant', () => {
  // Sat 25 Jul 2026 21:10:26Z = 16:10 in Austin. Not an ISO string.
  assert.ok(Number.isNaN(new Date('1785013826').getTime()), 'literal must not parse as a date');
  assert.equal(orderSaleInstantMs({ tt_created_at: '1785013826' }), 1785013826000);
  assert.equal(venueDateString(1785013826000), '2026-07-25');
});

test('epoch-seconds string orders bucket into the right day, week and month', () => {
  const now = new Date('2026-07-26T12:00:00Z');
  // A backfilled February order alongside a recent one, both epoch-seconds
  // strings. `created_at` is deliberately a *different* month so a regression
  // that fell back to the row insert time would bucket these wrongly.
  const orders = [
    dbRow(1771034400, 74000, '2026-07-26T09:00:00Z'), // 2026-02-14T02:00Z -> Feb 13 in Austin
    dbRow(1785013826, 2500, '2026-07-26T09:00:00Z'), // 2026-07-25T21:10Z -> Jul 25 in Austin
  ];

  const all = buildAllSalesSeries({ orders, now });

  const feb = all.month.find((b) => b.key === '2026-02');
  assert.equal(feb.grossCents, 74000, 'February history must appear in the month view');
  assert.equal(feb.ordersCount, 1);
  assert.equal(all.month.find((b) => b.key === '2026-07').grossCents, 2500);
  assert.equal(summarizeSeries(all.month).grossCents, 76500);

  // Feb 13 is 5+ months back, so it is outside the 30-day and 12-week windows —
  // only the July order lands there.
  assert.equal(all.day.find((b) => b.key === '2026-07-25').grossCents, 2500);
  assert.equal(summarizeSeries(all.day).grossCents, 2500);
  // Jul 25 2026 is a Saturday: ISO week of Mon Jul 20.
  assert.equal(all.week.find((b) => b.key === '2026-07-20').grossCents, 2500);
  assert.equal(summarizeSeries(all.week).grossCents, 2500);
});

test('an epoch-seconds string is not mistaken for a millisecond timestamp', () => {
  // 1774031400 read as MILLISECONDS would be Jan 1970 and get dropped by the
  // SALES_DATA_START_DATE clamp, emptying the whole month view.
  const series = buildSalesSeries({
    granularity: 'month',
    now: new Date('2026-03-25T12:00:00Z'),
    orders: [dbRow(1774031400, 5000, '2026-07-26T09:00:00Z')], // 2026-03-20T18:30Z
  });
  assert.equal(series.find((b) => b.key === '2026-03').grossCents, 5000);
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

  // Clamped at SALES_DATA_START_DATE: Feb–Jul 2026 is 6 buckets, not a full 12.
  assert.equal(series.length, 6);
  assert.equal(series.at(-1).key, '2026-07');
  assert.equal(series[0].key, '2026-02');
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
    // Day/week windows sit entirely after Feb 2026; the month window is clamped.
    assert.equal(all[g].length, g === 'month' ? 6 : DEFAULT_BUCKET_COUNT[g]);
    assert.equal(summarizeSeries(all[g]).grossCents, 1500);
  }
});

test('earliestWindowStartIso covers the widest default window', () => {
  const iso = earliestWindowStartIso(NOW);
  // 12 months back from Jul 2026 would be Aug 2025, but the query bound is
  // clamped to SALES_DATA_START_DATE (padded a day earlier for the UTC compare)
  // so we never ask the database for pre-history rows.
  assert.equal(iso, '2026-01-31T00:00:00.000Z');
  // Every default window must start at or after this bound.
  for (const g of GRANULARITIES) {
    const first = buildSalesSeries({ granularity: g, now: NOW })[0].startDate;
    assert.ok(Date.parse(`${first}T00:00:00Z`) >= Date.parse(iso), `${g} window starts before the query bound`);
  }
});

// ---------------------------------------------------------------------------
// Hard lower bound: nothing before SALES_DATA_START_DATE (2026-02-01, Austin).
// ---------------------------------------------------------------------------

test('SALES_DATA_START_DATE is the documented start of tracked history', () => {
  assert.equal(SALES_DATA_START_DATE, '2026-02-01');
});

test('floorBucketKey resolves the oldest allowed bucket per granularity', () => {
  assert.equal(floorBucketKey('day'), '2026-02-01');
  assert.equal(floorBucketKey('month'), '2026-02');
  // Feb 1 2026 is a SUNDAY, so its ISO week starts the preceding Monday.
  assert.equal(floorBucketKey('week'), '2026-01-26');
});

test('month view clamps a 12-month lookback to February 2026', () => {
  const series = buildSalesSeries({ granularity: 'month', now: NOW });
  assert.equal(series.length, 6); // Feb, Mar, Apr, May, Jun, Jul
  assert.deepEqual(series.map((b) => b.key), ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']);
});

test('week view clamps to the ISO week containing Feb 1 2026', () => {
  // 12 weeks back from the week of Mar 9 2026 would reach mid-December 2025.
  const series = buildSalesSeries({ granularity: 'week', now: new Date('2026-03-11T12:00:00Z') });
  assert.equal(series[0].key, '2026-01-26');
  assert.ok(series.length < DEFAULT_BUCKET_COUNT.week, 'expected the week window to be clamped');
  assert.ok(series.every((b) => b.key >= '2026-01-26'));
});

test('day view clamps a lookback that would cross Feb 1 2026', () => {
  // The default 30-day window does not reach the bound from July, so widen it
  // via `count` to prove the clamp is real and not just unreachable.
  const series = buildSalesSeries({ granularity: 'day', count: 60, now: new Date('2026-02-20T12:00:00Z') });
  assert.equal(series[0].key, '2026-02-01');
  assert.equal(series.at(-1).key, '2026-02-20');
  assert.equal(series.length, 20);
});

test('the default 30-day window is untouched when it sits after the bound', () => {
  const series = buildSalesSeries({ granularity: 'day', now: NOW });
  assert.equal(series.length, DEFAULT_BUCKET_COUNT.day);
  assert.equal(series[0].key, '2026-06-16');
});

test('every granularity is empty when today predates tracked history', () => {
  const before = new Date('2026-01-10T12:00:00Z');
  for (const g of GRANULARITIES) {
    assert.deepEqual(buildSalesSeries({ granularity: g, now: before }), [], `${g} should be empty`);
  }
  const all = buildAllSalesSeries({ orders: [order('2026-01-09T14:00:00Z', 5000)], now: before });
  for (const g of GRANULARITIES) assert.deepEqual(all[g], []);
});

test('day/month views are empty the day before the bound, non-empty on it', () => {
  const jan31 = new Date('2026-01-31T18:00:00Z'); // noon in Austin, Jan 31
  assert.deepEqual(buildSalesSeries({ granularity: 'day', now: jan31 }), []);
  assert.deepEqual(buildSalesSeries({ granularity: 'month', now: jan31 }), []);

  const feb1 = new Date('2026-02-01T18:00:00Z');
  const day = buildSalesSeries({ granularity: 'day', now: feb1 });
  assert.equal(day.length, 1);
  assert.equal(day[0].key, '2026-02-01');
  const month = buildSalesSeries({ granularity: 'month', now: feb1 });
  assert.deepEqual(month.map((b) => b.key), ['2026-02']);
});

test('the week straddling the bound renders once today reaches that week', () => {
  // Mon Jan 26 2026 is inside the week that contains Feb 1, so the bucket is
  // allowed even though "today" is still January.
  const inWeek = buildSalesSeries({ granularity: 'week', now: new Date('2026-01-28T18:00:00Z') });
  assert.deepEqual(inWeek.map((b) => b.key), ['2026-01-26']);
  // The prior week is entirely before tracked history.
  assert.deepEqual(buildSalesSeries({ granularity: 'week', now: new Date('2026-01-21T18:00:00Z') }), []);
});

test('pre-bound orders never count, even inside the straddling first week', () => {
  const series = buildSalesSeries({
    granularity: 'week',
    now: new Date('2026-02-04T12:00:00Z'),
    orders: [
      order('2026-01-27T18:00:00Z', 9999), // Tue Jan 27 — same ISO week, out of history
      order('2026-01-31T18:00:00Z', 8888), // Sat Jan 31 — still out
      order('2026-02-01T18:00:00Z', 1200), // Sun Feb 1 — the one in-range day
    ],
  });

  const first = series.find((b) => b.key === '2026-01-26');
  assert.equal(first.grossCents, 1200, 'only the Feb 1 order may count');
  assert.equal(first.ordersCount, 1);
  assert.equal(summarizeSeries(series).grossCents, 1200);
});

test('pre-bound orders are excluded from day and month views too', () => {
  const orders = [
    order('2026-01-31T18:00:00Z', 7777),
    order('2026-02-02T18:00:00Z', 300),
  ];
  for (const g of ['day', 'month']) {
    const series = buildSalesSeries({ granularity: g, now: new Date('2026-02-10T12:00:00Z'), orders });
    assert.equal(summarizeSeries(series).grossCents, 300, `${g} must drop the January order`);
    assert.equal(summarizeSeries(series).ordersCount, 1);
  }
});

test('earliestWindowStartIso never asks for rows before the bound', () => {
  // Even from a date whose 12-month lookback is deep in 2025.
  assert.equal(earliestWindowStartIso(new Date('2026-03-01T12:00:00Z')), '2026-01-31T00:00:00.000Z');
  // And from before the bound entirely.
  assert.equal(earliestWindowStartIso(new Date('2026-01-05T12:00:00Z')), '2026-01-31T00:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Paged order read. PostgREST caps a response at the project's max-rows setting
// and ignores a larger .limit(), so a single request silently truncates once the
// table outgrows the cap — which is what hid the backfilled Feb–Jun history.
// ---------------------------------------------------------------------------

// A fake table of `total` rows served through .range()-style windows, recording
// the windows it was asked for. `serverCap` mirrors PostgREST's max-rows: a
// requested range wider than the cap still yields at most that many rows.
function pagedSource(total, serverCap = ORDER_PAGE_SIZE) {
  const rows = Array.from({ length: total }, (_, i) => ({ n: i }));
  const calls = [];
  return {
    calls,
    fetchPage: async ({ from, to }) => {
      calls.push([from, to]);
      return rows.slice(from, Math.min(to + 1, from + serverCap));
    },
  };
}

test('fetchAllOrderPages reads past a single max-rows page', async () => {
  const source = pagedSource(1434);
  const orders = await fetchAllOrderPages(source);

  // The bug: one request would have returned 1000 of these and silently dropped
  // the rest.
  assert.equal(orders.length, 1434, 'all rows must be read, not just the first page');
  assert.deepEqual(orders.map((r) => r.n), Array.from({ length: 1434 }, (_, i) => i));
  assert.deepEqual(source.calls, [[0, 999], [1000, 1999], [1434, 2433]]);
});

test('fetchAllOrderPages reads everything when the server cap is below the page size', async () => {
  // A project configured with max-rows=300 hands back short pages from the very
  // first request, so "short page means last page" would truncate at 300.
  const source = pagedSource(700, 300);
  const orders = await fetchAllOrderPages(source);

  assert.equal(orders.length, 700);
  assert.deepEqual(orders.map((r) => r.n), Array.from({ length: 700 }, (_, i) => i));
  // Offsets advance by rows actually received, not by the requested page size.
  assert.deepEqual(source.calls, [[0, 999], [300, 1299], [600, 1599], [700, 1699]]);
});

test('fetchAllOrderPages ends on an empty page', async () => {
  const source = pagedSource(2000);
  assert.equal((await fetchAllOrderPages(source)).length, 2000);
  assert.deepEqual(source.calls, [[0, 999], [1000, 1999], [2000, 2999]]);

  const small = pagedSource(400);
  assert.equal((await fetchAllOrderPages(small)).length, 400);
  assert.deepEqual(small.calls, [[0, 999], [400, 1399]]);
});

test('fetchAllOrderPages degrades to an empty chart when the read fails', async () => {
  // The page returns [] on a Supabase error (missing table, bad grant).
  assert.deepEqual(await fetchAllOrderPages({ fetchPage: async () => [] }), []);
  assert.deepEqual(await fetchAllOrderPages({ fetchPage: async () => null }), []);
});

test('a paged read feeds the same series a single read would have', async () => {
  const source = {
    fetchPage: async ({ from }) => (from === 0
      ? [dbRow(1771034400, 74000, '2026-07-26T09:00:00Z')]
      : []),
  };
  const orders = await fetchAllOrderPages(source);
  const series = buildSalesSeries({ orders, granularity: 'month', now: new Date('2026-07-26T12:00:00Z') });
  assert.equal(series.find((b) => b.key === '2026-02').grossCents, 74000);
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

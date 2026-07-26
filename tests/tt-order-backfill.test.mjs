import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKFILL_START_DATE,
  ttOrderCreatedMs,
  buildAttributionRow,
  isInBackfillWindow,
  selectBackfillRows,
  chunkRows,
  coveredDateRange,
  summarizeRows,
  paginateOrders,
} from '../lib/tt-order-backfill.js';
import { SALES_DATA_START_DATE } from '../lib/ticket-sales-timeseries.js';

// The suite runs under TZ=UTC (see package.json), so the Austin-local
// assertions below are genuinely exercising America/Chicago handling rather
// than agreeing with the host clock by coincidence.

const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

// A realistic GET /v1/orders row (subset of real fields), shaped like what the
// webhook receives as envelope.payload.
const ttOrder = (overrides = {}) => ({
  id: 'or_1001',
  object: 'order',
  status: 'completed',
  created_at: unix('2026-03-14T19:30:00Z'),
  total_paid: 4500,
  total: 4500,
  currency: { code: 'usd', symbol: '$' },
  buyer_details: { email: 'Buyer@Example.com', name: 'A Buyer' },
  event_summary: { event_id: 'ev_500', event_series_id: 'es_500', name: 'March Warehouse Party' },
  ...overrides,
});

const eventMap = new Map([['es_500', '11111111-2222-3333-4444-555555555555']]);

test('the backfill window starts where the chart starts', () => {
  assert.equal(BACKFILL_START_DATE, SALES_DATA_START_DATE);
  assert.equal(BACKFILL_START_DATE, '2026-02-01');
});

// ---------------------------------------------------------------------------
// Timestamp conversion — the whole point of the script
// ---------------------------------------------------------------------------

test('ttOrderCreatedMs reads TicketTailor unix SECONDS, not milliseconds', () => {
  assert.equal(ttOrderCreatedMs({ created_at: unix('2026-03-14T19:30:00Z') }), Date.parse('2026-03-14T19:30:00Z'));
  // A numeric string is still seconds.
  assert.equal(ttOrderCreatedMs({ created_at: String(unix('2026-03-14T19:30:00Z')) }), Date.parse('2026-03-14T19:30:00Z'));
});

test('ttOrderCreatedMs falls back to an ISO string and rejects junk', () => {
  assert.equal(ttOrderCreatedMs({ created_at: '2026-03-14T19:30:00Z' }), Date.parse('2026-03-14T19:30:00Z'));
  assert.equal(ttOrderCreatedMs({ created_at: 'nope' }), null);
  assert.equal(ttOrderCreatedMs({ created_at: 0 }), null);
  assert.equal(ttOrderCreatedMs({}), null);
  assert.equal(ttOrderCreatedMs(null), null);
});

test('the row carries the historical order date, never the run date', () => {
  const row = buildAttributionRow(ttOrder(), { localEventIdBySeriesId: eventMap });
  assert.equal(row.created_at, '2026-03-14T19:30:00.000Z');
  // Guard the actual bug this script exists to prevent: a row stamped "today"
  // would sort into the current month and leave the chart just as wrong.
  assert.notEqual(row.created_at.slice(0, 7), new Date().toISOString().slice(0, 7));
});

// ---------------------------------------------------------------------------
// Field mapping — must match the webhook's upsert
// ---------------------------------------------------------------------------

test('buildAttributionRow maps every column the webhook writes', () => {
  const row = buildAttributionRow(ttOrder(), { localEventIdBySeriesId: eventMap });
  assert.deepEqual(row, {
    tt_order_id: 'or_1001',
    tt_event_id: 'ev_500',
    local_event_id: '11111111-2222-3333-4444-555555555555',
    buyer_email: 'Buyer@Example.com',
    total_paid_cents: 4500,
    currency: 'USD',
    status: 'completed',
    raw_payload: ttOrder(),
    created_at: '2026-03-14T19:30:00.000Z',
  });
});

test('raw_payload keeps the created_at key the sales chart reads', () => {
  // lib/ticket-sales-timeseries.js buckets by raw_payload->>created_at, so the
  // stored payload must retain TT's own unix-seconds timestamp.
  const row = buildAttributionRow(ttOrder(), {});
  assert.equal(row.raw_payload.created_at, unix('2026-03-14T19:30:00Z'));
});

test('Mailchimp attribution columns are left unset for backfilled rows', () => {
  const row = buildAttributionRow(ttOrder(), {});
  for (const col of ['matched_mc_cid', 'matched_click_id', 'mailchimp_synced', 'mailchimp_sync_error']) {
    assert.ok(!(col in row), `${col} must be left at its column default`);
  }
});

test('buildAttributionRow does not scale total_paid — TT already sends minor units', () => {
  assert.equal(buildAttributionRow(ttOrder({ total_paid: 12345 }), {}).total_paid_cents, 12345);
  // Falls back to `total` exactly like the webhook does.
  assert.equal(buildAttributionRow(ttOrder({ total_paid: undefined, total: 900 }), {}).total_paid_cents, 900);
  assert.equal(buildAttributionRow(ttOrder({ total_paid: '2500' }), {}).total_paid_cents, 2500);
});

test('unusable amounts become 0 rather than violating the check constraint', () => {
  // total_paid_cents has `check (>= 0)`; a negative would abort the whole batch.
  assert.equal(buildAttributionRow(ttOrder({ total_paid: -500, total: -500 }), {}).total_paid_cents, 0);
  assert.equal(buildAttributionRow(ttOrder({ total_paid: null, total: null }), {}).total_paid_cents, 0);
  assert.equal(buildAttributionRow(ttOrder({ total_paid: 'abc', total: 'abc' }), {}).total_paid_cents, 0);
});

test('status is lowercased and currency defaults to USD', () => {
  assert.equal(buildAttributionRow(ttOrder({ status: 'CANCELED' }), {}).status, 'canceled');
  assert.equal(buildAttributionRow(ttOrder({ currency: undefined }), {}).currency, 'USD');
  assert.equal(buildAttributionRow(ttOrder({ currency: { code: 'gbp' } }), {}).currency, 'GBP');
});

test('an unmatched event series leaves local_event_id null instead of guessing', () => {
  const row = buildAttributionRow(ttOrder({ event_summary: { event_id: 'ev_9', event_series_id: 'es_unknown' } }), {
    localEventIdBySeriesId: eventMap,
  });
  assert.equal(row.local_event_id, null);
  assert.equal(row.tt_event_id, 'ev_9');
  assert.equal(buildAttributionRow(ttOrder({ event_summary: undefined }), {}).tt_event_id, null);
});

test('orders that cannot be keyed or dated are dropped, not invented', () => {
  assert.equal(buildAttributionRow(ttOrder({ id: undefined }), {}), null);
  assert.equal(buildAttributionRow(ttOrder({ created_at: undefined }), {}), null);
  assert.equal(buildAttributionRow(null, {}), null);
});

// ---------------------------------------------------------------------------
// Window filtering
// ---------------------------------------------------------------------------

test('isInBackfillWindow excludes orders before tracked history', () => {
  assert.equal(isInBackfillWindow(ttOrder({ created_at: unix('2026-01-31T18:00:00Z') })), false);
  assert.equal(isInBackfillWindow(ttOrder({ created_at: unix('2026-02-01T18:00:00Z') })), true);
});

test('the window boundary is an Austin day, not a UTC one', () => {
  // 03:00Z Feb 1 is still 21:00 Jan 31 in Austin (CST) — out of range.
  assert.equal(isInBackfillWindow(ttOrder({ created_at: unix('2026-02-01T03:00:00Z') })), false);
  // 06:30Z Feb 1 is 00:30 Feb 1 in Austin — in range.
  assert.equal(isInBackfillWindow(ttOrder({ created_at: unix('2026-02-01T06:30:00Z') })), true);
});

test('future-dated orders are excluded by the end bound', () => {
  const endMs = Date.parse('2026-07-26T12:00:00Z');
  assert.equal(isInBackfillWindow(ttOrder({ created_at: unix('2026-07-25T12:00:00Z') }), { endMs }), true);
  assert.equal(isInBackfillWindow(ttOrder({ created_at: unix('2026-08-01T12:00:00Z') }), { endMs }), false);
});

// ---------------------------------------------------------------------------
// Selection over a realistic mocked API page
// ---------------------------------------------------------------------------

test('selectBackfillRows partitions a mixed page and reports why rows dropped', () => {
  const { rows, outOfWindow, unusable, duplicates } = selectBackfillRows(
    [
      ttOrder({ id: 'or_a', created_at: unix('2026-02-10T18:00:00Z') }),
      ttOrder({ id: 'or_b', created_at: unix('2026-01-15T18:00:00Z') }), // before history
      ttOrder({ id: 'or_a', created_at: unix('2026-02-10T18:00:00Z') }), // repeated page
      ttOrder({ id: undefined, created_at: unix('2026-03-01T18:00:00Z') }), // unkeyable
      ttOrder({ id: 'or_c', created_at: 'garbage' }), // undatable
      null,
      ttOrder({ id: 'or_d', created_at: unix('2026-06-05T18:00:00Z') }),
    ],
    { endMs: Date.parse('2026-07-26T12:00:00Z'), localEventIdBySeriesId: eventMap },
  );

  assert.deepEqual(rows.map((r) => r.tt_order_id), ['or_a', 'or_d']);
  assert.equal(outOfWindow, 2); // the January order and the undatable one
  assert.equal(unusable, 2); // the id-less order and the null
  assert.equal(duplicates, 1);
});

test('selected rows are ordered oldest first', () => {
  const { rows } = selectBackfillRows([
    ttOrder({ id: 'or_jun', created_at: unix('2026-06-01T18:00:00Z') }),
    ttOrder({ id: 'or_feb', created_at: unix('2026-02-02T18:00:00Z') }),
    ttOrder({ id: 'or_apr', created_at: unix('2026-04-03T18:00:00Z') }),
  ]);
  assert.deepEqual(rows.map((r) => r.tt_order_id), ['or_feb', 'or_apr', 'or_jun']);
});

test('non-completed orders are backfilled too, matching what the webhook records', () => {
  // The webhook upserts pending/canceled rows so status transitions stay
  // visible; only the chart filters to completed. The backfill must not
  // silently narrow that.
  const { rows } = selectBackfillRows([
    ttOrder({ id: 'or_p', status: 'pending', created_at: unix('2026-03-01T18:00:00Z') }),
    ttOrder({ id: 'or_x', status: 'canceled', created_at: unix('2026-03-02T18:00:00Z') }),
  ]);
  assert.deepEqual(rows.map((r) => r.status), ['pending', 'canceled']);
});

test('selectBackfillRows handles an empty API response', () => {
  assert.deepEqual(selectBackfillRows([]), { rows: [], outOfWindow: 0, unusable: 0, duplicates: 0 });
});

// ---------------------------------------------------------------------------
// Pagination against a mocked TicketTailor API
// ---------------------------------------------------------------------------

// Stands in for ttFetch('/orders?...'), returning TT's envelope shape and
// recording the cursors it was called with.
function mockApi(pages) {
  const calls = [];
  const fetchPage = async ({ startingAfter }) => {
    calls.push(startingAfter);
    return pages[calls.length - 1] ?? { data: [] };
  };
  return { fetchPage, calls };
}

const page = (orders, hasNext) => ({ data: orders, links: hasNext ? { next: 'https://api.tickettailor.com/v1/orders?...' } : {} });

test('paginateOrders follows the starting_after cursor across pages', async () => {
  const { fetchPage, calls } = mockApi([
    page([ttOrder({ id: 'or_1', created_at: unix('2026-07-20T18:00:00Z') })], true),
    page([ttOrder({ id: 'or_2', created_at: unix('2026-06-20T18:00:00Z') })], true),
    page([ttOrder({ id: 'or_3', created_at: unix('2026-05-20T18:00:00Z') })], false),
  ]);

  const { orders, pages, stoppedEarly, hitPageCap } = await paginateOrders({ fetchPage });

  assert.deepEqual(orders.map((o) => o.id), ['or_1', 'or_2', 'or_3']);
  // First call has no cursor; each subsequent one resumes after the last id.
  assert.deepEqual(calls, [null, 'or_1', 'or_2']);
  assert.equal(pages, 3);
  assert.equal(stoppedEarly, false);
  assert.equal(hitPageCap, false);
});

test('paginateOrders stops once a whole page predates the start date', async () => {
  const { fetchPage, calls } = mockApi([
    page([ttOrder({ id: 'or_1', created_at: unix('2026-03-01T18:00:00Z') })], true),
    // Entirely before Feb 2026 — nothing older is worth fetching.
    page([
      ttOrder({ id: 'or_old1', created_at: unix('2026-01-20T18:00:00Z') }),
      ttOrder({ id: 'or_old2', created_at: unix('2025-12-11T18:00:00Z') }),
    ], true),
    page([ttOrder({ id: 'or_never', created_at: unix('2025-11-01T18:00:00Z') })], true),
  ]);

  const { orders, stoppedEarly } = await paginateOrders({ fetchPage });

  assert.equal(stoppedEarly, true);
  assert.equal(calls.length, 2, 'must not request the third page');
  // The out-of-range page is still returned; selectBackfillRows filters it.
  assert.deepEqual(selectBackfillRows(orders).rows.map((r) => r.tt_order_id), ['or_1']);
});

test('paginateOrders keeps a page that merely straddles the start date', async () => {
  const { fetchPage, calls } = mockApi([
    page([
      ttOrder({ id: 'or_feb', created_at: unix('2026-02-05T18:00:00Z') }),
      ttOrder({ id: 'or_jan', created_at: unix('2026-01-25T18:00:00Z') }),
    ], true),
    page([ttOrder({ id: 'or_older', created_at: unix('2025-12-01T18:00:00Z') })], true),
  ]);

  const { stoppedEarly } = await paginateOrders({ fetchPage });

  // Page 1 is mixed, so paging continues; page 2 is wholly old and ends it.
  assert.equal(calls.length, 2);
  assert.equal(stoppedEarly, true);
});

test('paginateOrders stops when the API signals no next page', async () => {
  const { fetchPage, calls } = mockApi([
    page([ttOrder({ id: 'or_1', created_at: unix('2026-07-20T18:00:00Z') })], false),
    page([ttOrder({ id: 'or_2', created_at: unix('2026-07-19T18:00:00Z') })], true),
  ]);
  const { orders } = await paginateOrders({ fetchPage });
  assert.deepEqual(orders.map((o) => o.id), ['or_1']);
  assert.equal(calls.length, 1);
});

test('paginateOrders reports hitting the page cap so a short read is visible', async () => {
  const recent = (i) => ttOrder({ id: `or_${i}`, created_at: unix('2026-07-20T18:00:00Z') });
  const { fetchPage } = mockApi([page([recent(1)], true), page([recent(2)], true), page([recent(3)], true)]);

  const { orders, pages, hitPageCap } = await paginateOrders({ fetchPage, maxPages: 2 });

  assert.equal(pages, 2);
  assert.equal(orders.length, 2);
  assert.equal(hitPageCap, true);
});

test('paginateOrders handles an empty first page', async () => {
  const { fetchPage } = mockApi([page([], false)]);
  const { orders, stoppedEarly, hitPageCap } = await paginateOrders({ fetchPage });
  assert.deepEqual(orders, []);
  assert.equal(stoppedEarly, false);
  assert.equal(hitPageCap, false);
});

test('a full mocked run maps a TT page into insertable rows end to end', async () => {
  const { fetchPage } = mockApi([
    page([
      ttOrder({ id: 'or_mar', created_at: unix('2026-03-14T19:30:00Z'), total_paid: 4500 }),
      ttOrder({ id: 'or_feb', created_at: unix('2026-02-08T19:30:00Z'), total_paid: 2000 }),
    ], true),
    page([ttOrder({ id: 'or_dec', created_at: unix('2025-12-08T19:30:00Z'), total_paid: 9999 })], false),
  ]);

  const { orders } = await paginateOrders({ fetchPage });
  const { rows } = selectBackfillRows(orders, { localEventIdBySeriesId: eventMap });

  assert.deepEqual(rows.map((r) => [r.tt_order_id, r.created_at]), [
    ['or_feb', '2026-02-08T19:30:00.000Z'],
    ['or_mar', '2026-03-14T19:30:00.000Z'],
  ]);
  assert.deepEqual(summarizeRows(rows), { count: 2, grossCents: 6500, completed: 2 });
  assert.deepEqual(chunkRows(rows, 1).length, 2);
});

// ---------------------------------------------------------------------------
// Batching and summary
// ---------------------------------------------------------------------------

test('chunkRows splits evenly and keeps the remainder', () => {
  const rows = Array.from({ length: 450 }, (_, i) => ({ tt_order_id: `or_${i}` }));
  const batches = chunkRows(rows, 200);
  assert.deepEqual(batches.map((b) => b.length), [200, 200, 50]);
  assert.equal(batches.flat().length, 450);
  assert.deepEqual(chunkRows([], 200), []);
});

test('chunkRows falls back to a sane batch size on bad input', () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ tt_order_id: `or_${i}` }));
  assert.deepEqual(chunkRows(rows, 0).map((b) => b.length), [200, 100]);
  assert.deepEqual(chunkRows(rows, -5).map((b) => b.length), [200, 100]);
});

test('summarizeRows counts only completed orders as revenue', () => {
  const { rows } = selectBackfillRows([
    ttOrder({ id: 'or_1', total_paid: 2500, created_at: unix('2026-02-10T18:00:00Z') }),
    ttOrder({ id: 'or_2', total_paid: 1000, created_at: unix('2026-03-10T18:00:00Z') }),
    ttOrder({ id: 'or_3', total_paid: 9900, status: 'pending', created_at: unix('2026-04-10T18:00:00Z') }),
  ]);
  assert.deepEqual(summarizeRows(rows), { count: 3, grossCents: 3500, completed: 2 });
  assert.deepEqual(summarizeRows([]), { count: 0, grossCents: 0, completed: 0 });
});

test('coveredDateRange reports Austin-local first and last dates', () => {
  const { rows } = selectBackfillRows([
    ttOrder({ id: 'or_1', created_at: unix('2026-02-10T18:00:00Z') }),
    // 02:00Z Jun 6 is still Jun 5 in Austin — the range must say Jun 5.
    ttOrder({ id: 'or_2', created_at: unix('2026-06-06T02:00:00Z') }),
  ]);
  assert.deepEqual(coveredDateRange(rows), { first: '2026-02-10', last: '2026-06-05' });
  assert.equal(coveredDateRange([]), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTtOrderBackfill, loadLocalEventMap } from '../lib/tt-order-backfill-runner.js';

// Same fixtures as tests/tt-order-backfill.test.mjs — these exercise the
// orchestration around that pure logic, with both TicketTailor and Supabase
// mocked. The suite runs under TZ=UTC (see package.json).

const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

const ttOrder = (overrides = {}) => ({
  id: 'or_1001',
  object: 'order',
  status: 'completed',
  created_at: unix('2026-03-14T19:30:00Z'),
  total_paid: 4500,
  currency: { code: 'usd' },
  buyer_details: { email: 'buyer@example.com' },
  event_summary: { event_id: 'ev_500', event_series_id: 'es_500' },
  ...overrides,
});

const page = (orders, hasNext) => ({ data: orders, links: hasNext ? { next: 'https://api.tickettailor.com/v1/orders?...' } : {} });

function mockFetchPage(pages) {
  const calls = [];
  return {
    calls,
    fetchPage: async ({ startingAfter }) => {
      calls.push(startingAfter);
      return pages[calls.length - 1] ?? { data: [] };
    },
  };
}

// Stands in for the service-role Supabase client. Records every upsert so the
// tests can assert on what would actually hit the database, and reports
// `existing` order ids back as conflicts the way ON CONFLICT DO NOTHING does.
function mockSupabase({ events = [{ id: 'local-500', tt_event_series_id: 'es_500' }], existing = [], upsertError = null, eventsError = null } = {}) {
  const upserts = [];
  const from = (table) => {
    if (table === 'events') {
      const result = { data: events, error: eventsError };
      return { select: () => ({ not: () => Promise.resolve(result) }) };
    }
    return {
      upsert: (rows, options) => {
        upserts.push({ rows, options });
        return {
          select: () => Promise.resolve(
            upsertError
              ? { data: null, error: { message: upsertError } }
              : { data: rows.filter((r) => !existing.includes(r.tt_order_id)).map((r) => ({ tt_order_id: r.tt_order_id })), error: null },
          ),
        };
      },
    };
  };
  return { supabase: { from }, upserts };
}

const endOfHistory = [
  page([
    ttOrder({ id: 'or_jun', created_at: unix('2026-06-20T18:00:00Z'), total_paid: 3000 }),
    ttOrder({ id: 'or_mar', created_at: unix('2026-03-14T19:30:00Z'), total_paid: 4500 }),
  ], true),
  page([
    ttOrder({ id: 'or_feb', created_at: unix('2026-02-08T19:30:00Z'), total_paid: 2000 }),
    ttOrder({ id: 'or_jan', created_at: unix('2026-01-08T19:30:00Z'), total_paid: 9999 }),
  ], true),
  page([ttOrder({ id: 'or_dec', created_at: unix('2025-12-08T19:30:00Z') })], true),
];

test('loadLocalEventMap keys local event ids by TT series id', async () => {
  const { supabase } = mockSupabase({
    events: [{ id: 'local-a', tt_event_series_id: 'es_a' }, { id: 'local-b', tt_event_series_id: 'es_b' }],
  });
  const map = await loadLocalEventMap(supabase);
  assert.equal(map.get('es_a'), 'local-a');
  assert.equal(map.size, 2);
});

test('loadLocalEventMap surfaces a database error instead of silently returning nothing', async () => {
  const { supabase } = mockSupabase({ eventsError: { message: 'permission denied' } });
  await assert.rejects(() => loadLocalEventMap(supabase), /permission denied/);
});

test('a dry run reports real counts and writes nothing', async () => {
  const { fetchPage } = mockFetchPage(endOfHistory);
  const { supabase, upserts } = mockSupabase();

  const res = await runTtOrderBackfill({ fetchPage, supabase, dryRun: true });

  assert.equal(res.dryRun, true);
  assert.equal(res.written, false);
  assert.equal(upserts.length, 0, 'a dry run must not touch the database');
  assert.equal(res.fetched, 5, 'pagination stops after the page that wholly predates February');
  assert.equal(res.selected, 3);
  assert.equal(res.outOfWindow, 2);
  assert.equal(res.completed, 3);
  assert.equal(res.grossCents, 9500);
  assert.deepEqual(res.dateRange, { first: '2026-02-08', last: '2026-06-20' });
  assert.equal(res.inserted, 0);
});

test('dryRun defaults to true, so an argument-less run cannot write', async () => {
  const { fetchPage } = mockFetchPage(endOfHistory);
  const { supabase, upserts } = mockSupabase();
  const res = await runTtOrderBackfill({ fetchPage, supabase });
  assert.equal(res.dryRun, true);
  assert.equal(upserts.length, 0);
});

test('a live run upserts with ON CONFLICT DO NOTHING and historical timestamps', async () => {
  const { fetchPage } = mockFetchPage(endOfHistory);
  const { supabase, upserts } = mockSupabase();

  const res = await runTtOrderBackfill({ fetchPage, supabase, dryRun: false });

  assert.equal(res.written, true);
  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0].options, { onConflict: 'tt_order_id', ignoreDuplicates: true });

  const written = upserts[0].rows;
  assert.deepEqual(written.map((r) => [r.tt_order_id, r.created_at]), [
    ['or_feb', '2026-02-08T19:30:00.000Z'],
    ['or_mar', '2026-03-14T19:30:00.000Z'],
    ['or_jun', '2026-06-20T18:00:00.000Z'],
  ]);
  // The bug this whole feature exists to avoid: rows filed under the run date.
  const thisMonth = new Date().toISOString().slice(0, 7);
  for (const row of written) assert.notEqual(row.created_at.slice(0, 7), thisMonth);
  // The webhook's per-order events lookup is reproduced for backfilled rows.
  assert.equal(written[0].local_event_id, 'local-500');
});

test('rows the live webhook already wrote are counted as already present, not duplicated', async () => {
  const { fetchPage } = mockFetchPage(endOfHistory);
  const { supabase } = mockSupabase({ existing: ['or_jun'] });

  const res = await runTtOrderBackfill({ fetchPage, supabase, dryRun: false });

  assert.equal(res.selected, 3);
  assert.equal(res.inserted, 2);
  assert.equal(res.alreadyPresent, 1);
});

test('a live run splits into batches and totals the inserts across them', async () => {
  const { fetchPage } = mockFetchPage(endOfHistory);
  const { supabase, upserts } = mockSupabase();

  const res = await runTtOrderBackfill({ fetchPage, supabase, dryRun: false, batchSize: 2 });

  assert.equal(res.batches, 2);
  assert.deepEqual(upserts.map((u) => u.rows.length), [2, 1]);
  assert.equal(res.inserted, 3);
});

test('a failing batch aborts with the batch number rather than reporting success', async () => {
  const { fetchPage } = mockFetchPage(endOfHistory);
  const { supabase } = mockSupabase({ upsertError: 'statement timeout' });
  await assert.rejects(
    () => runTtOrderBackfill({ fetchPage, supabase, dryRun: false }),
    /batch 1\/1 failed: statement timeout/,
  );
});

test('an empty TicketTailor account is reported, not written', async () => {
  const { fetchPage } = mockFetchPage([page([], false)]);
  const { supabase, upserts } = mockSupabase();

  const res = await runTtOrderBackfill({ fetchPage, supabase, dryRun: false });

  assert.equal(res.fetched, 0);
  assert.equal(res.selected, 0);
  assert.equal(res.written, false);
  assert.equal(res.dateRange, null);
  assert.equal(upserts.length, 0);
});

test('hitting the pagination cap is surfaced so a short read is visible', async () => {
  const recent = (i) => ttOrder({ id: `or_${i}`, created_at: unix('2026-07-20T18:00:00Z') });
  const { fetchPage } = mockFetchPage([page([recent(1)], true), page([recent(2)], true), page([recent(3)], true)]);
  const { supabase } = mockSupabase();

  const res = await runTtOrderBackfill({ fetchPage, supabase, maxPages: 2 });

  assert.equal(res.hitPageCap, true);
  assert.equal(res.pages, 2);
});

test('the summary never leaks raw payloads or credentials to the caller', async () => {
  const { fetchPage } = mockFetchPage(endOfHistory);
  const { supabase } = mockSupabase();
  const res = await runTtOrderBackfill({ fetchPage, supabase, dryRun: true });
  // The response is serialized straight to an admin browser; it must be counts
  // and dates only, never buyer emails or full order objects.
  assert.deepEqual(
    Object.keys(res).sort(),
    [
      'alreadyPresent', 'batches', 'completed', 'dateRange', 'dryRun', 'duplicates',
      'fetched', 'finishedAt', 'grossCents', 'hitPageCap', 'inserted', 'outOfWindow',
      'pages', 'selected', 'startDate', 'startedAt', 'stoppedEarly', 'unusable', 'written',
    ],
  );
});

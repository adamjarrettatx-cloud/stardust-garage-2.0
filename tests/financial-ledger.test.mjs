import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountToCents,
  buildTicketTailorLedgerRows,
  centsToAmount,
  currentMonthRange,
  filterTransactions,
  monthlyTrend,
  monthsAgoStart,
  normalizeTransaction,
  summarizeByAccount,
  summarizeLedger,
  toDateOnly,
} from '../lib/financial-ledger.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

// --- Money at the DB boundary ----------------------------------------------

test('centsToAmount emits an exact fixed-2 decimal string', () => {
  assert.equal(centsToAmount(0), '0.00');
  assert.equal(centsToAmount(5), '0.05');
  assert.equal(centsToAmount(1234), '12.34');
  assert.equal(centsToAmount(123456789), '1234567.89');
  assert.equal(centsToAmount(-1234), '-12.34');
});

test('amountToCents round-trips numeric column values', () => {
  assert.equal(amountToCents('12.34'), 1234);
  assert.equal(amountToCents(12.34), 1234);
  assert.equal(amountToCents('$1,234.56'), 123456);
  assert.equal(amountToCents(null), 0);
  assert.equal(amountToCents('not money'), 0);
});

test('cents survive a full round trip through the numeric boundary', () => {
  for (const cents of [1, 99, 100, 4999, 1000000, 123456789]) {
    assert.equal(amountToCents(centsToAmount(cents)), cents);
  }
});

// --- Dates ------------------------------------------------------------------

test('toDateOnly takes a date-only string verbatim rather than reparsing it', () => {
  assert.equal(toDateOnly('2026-07-01'), '2026-07-01');
  assert.equal(toDateOnly('2026-07-01T23:30:00Z'), '2026-07-01');
  assert.equal(toDateOnly(new Date(2026, 6, 1)), '2026-07-01');
  assert.equal(toDateOnly(null), null);
  assert.equal(toDateOnly('nonsense'), null);
});

test('currentMonthRange spans the whole calendar month', () => {
  assert.deepEqual(currentMonthRange(new Date(2026, 6, 15)), { start: '2026-07-01', end: '2026-07-31' });
  // February in a leap year still ends on the real last day.
  assert.deepEqual(currentMonthRange(new Date(2028, 1, 5)), { start: '2028-02-01', end: '2028-02-29' });
});

test('monthsAgoStart is inclusive of the current month', () => {
  assert.equal(monthsAgoStart(12, new Date(2026, 6, 26)), '2025-08-01');
  assert.equal(monthsAgoStart(1, new Date(2026, 6, 26)), '2026-07-01');
});

// --- Summaries --------------------------------------------------------------

function txn(overrides = {}) {
  return normalizeTransaction({
    id: overrides.id || 'x',
    account_id: overrides.account_id || ACCOUNT,
    transaction_date: overrides.transaction_date || '2026-07-10',
    amount: overrides.amount ?? '100.00',
    direction: overrides.direction || 'in',
    txn_type: overrides.txn_type || 'operating',
    category: overrides.category ?? 'Ticket Revenue',
    source: overrides.source || 'tickettailor',
    ...overrides,
  });
}

test('summarizeLedger nets inflow against outflow', () => {
  const result = summarizeLedger([
    txn({ id: 'a', amount: '100.00', direction: 'in' }),
    txn({ id: 'b', amount: '25.50', direction: 'out' }),
  ]);
  assert.equal(result.inflowCents, 10000);
  assert.equal(result.outflowCents, 2550);
  assert.equal(result.netCents, 7450);
  assert.equal(result.counted, 2);
});

// Transfers move money between the business's own accounts. Counting them would
// double-report cash flow, which is the whole reason txn_type exists.
test('summarizeLedger excludes transfer rows from every total', () => {
  const result = summarizeLedger([
    txn({ id: 'a', amount: '100.00', direction: 'in' }),
    txn({ id: 'b', amount: '500.00', direction: 'out', txn_type: 'transfer' }),
    txn({ id: 'c', amount: '500.00', direction: 'in', txn_type: 'transfer' }),
  ]);
  assert.equal(result.inflowCents, 10000);
  assert.equal(result.outflowCents, 0);
  assert.equal(result.counted, 1);
  assert.equal(result.count, 3);
});

test('summarizeByAccount names each bucket and sorts by inflow', () => {
  const other = '22222222-2222-4222-8222-222222222222';
  const rows = summarizeByAccount(
    [
      txn({ id: 'a', amount: '10.00' }),
      txn({ id: 'b', amount: '90.00', account_id: other }),
      txn({ id: 'c', amount: '5.00', direction: 'out', account_id: other }),
    ],
    [
      { id: ACCOUNT, name: 'TicketTailor', account_type: 'ticketing' },
      { id: other, name: 'SpotOn POS', account_type: 'pos' },
    ],
  );
  assert.deepEqual(rows.map((r) => r.name), ['SpotOn POS', 'TicketTailor']);
  assert.equal(rows[0].inflowCents, 9000);
  assert.equal(rows[0].outflowCents, 500);
  assert.equal(rows[0].netCents, 8500);
});

test('monthlyTrend always returns a full run of buckets, zeros included', () => {
  const buckets = monthlyTrend(
    [
      txn({ id: 'a', transaction_date: '2026-07-02', amount: '40.00' }),
      txn({ id: 'b', transaction_date: '2026-05-31', amount: '10.00', direction: 'out' }),
      // Outside the window entirely — must not leak into any bucket.
      txn({ id: 'c', transaction_date: '2020-01-01', amount: '999.00' }),
    ],
    { months: 3, today: new Date(2026, 6, 26) },
  );
  assert.deepEqual(buckets.map((b) => b.key), ['2026-05', '2026-06', '2026-07']);
  assert.equal(buckets[0].outflowCents, 1000);
  assert.equal(buckets[1].inflowCents, 0);
  assert.equal(buckets[2].inflowCents, 4000);
  assert.equal(buckets[2].netCents, 4000);
});

test('filterTransactions applies inclusive bounds and the account filter', () => {
  const rows = [
    txn({ id: 'a', transaction_date: '2026-07-01' }),
    txn({ id: 'b', transaction_date: '2026-07-31' }),
    txn({ id: 'c', transaction_date: '2026-08-01' }),
  ];
  assert.deepEqual(
    filterTransactions(rows, { start: '2026-07-01', end: '2026-07-31' }).map((r) => r.id),
    ['a', 'b'],
  );
  assert.equal(filterTransactions(rows, { accountId: 'nope' }).length, 0);
});

// --- TicketTailor sync ------------------------------------------------------

const EVENT = { id: 'e1', title: 'Yoga Night', event_date: '2026-07-04', tt_event_series_id: 'ts_1' };

function metricsRow(overrides = {}) {
  return {
    event_id: 'e1',
    tt_event_series_id: 'ts_1',
    tickets_sold: 20,
    orders_count: 12,
    gross_cents: 50000,
    fees_cents: 2500,
    net_cents: 47500,
    status: 'ok',
    fetched_at: '2026-07-05T00:00:00.000Z',
    ...overrides,
  };
}

test('buildTicketTailorLedgerRows recognizes gross revenue on the event date', () => {
  const { rows } = buildTicketTailorLedgerRows({
    events: [EVENT],
    metrics: [metricsRow()],
    accountId: ACCOUNT,
    createdBy: 'user-1',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].transaction_date, '2026-07-04');
  // Gross, not net: fee deduction is explicitly out of scope for this phase.
  assert.equal(rows[0].amount, '500.00');
  assert.equal(rows[0].direction, 'in');
  assert.equal(rows[0].txn_type, 'operating');
  assert.equal(rows[0].category, 'Ticket Revenue');
  assert.equal(rows[0].source, 'tickettailor');
  assert.equal(rows[0].linked_event_id, 'e1');
  assert.equal(rows[0].created_by, 'user-1');
  assert.equal(rows[0].metadata.fees_cents, 2500);
});

// (source, external_ref) is the idempotency key behind the unique index, so a
// re-run must produce the exact same key rather than a fresh one.
test('buildTicketTailorLedgerRows is idempotent on the event id', () => {
  const args = { events: [EVENT], metrics: [metricsRow()], accountId: ACCOUNT };
  const first = buildTicketTailorLedgerRows(args).rows;
  const second = buildTicketTailorLedgerRows(args).rows;
  assert.equal(first[0].external_ref, 'e1');
  assert.equal(first[0].external_ref, second[0].external_ref);
});

// An un-refreshed, not_configured, errored, or genuinely-zero event must not
// materialize a fabricated $0 ledger entry.
test('buildTicketTailorLedgerRows skips anything that is not real revenue', () => {
  const { rows, skipped } = buildTicketTailorLedgerRows({
    events: [
      EVENT,
      { id: 'e2', title: 'No metrics', event_date: '2026-07-05' },
      { id: 'e3', title: 'Not configured', event_date: '2026-07-06' },
      { id: 'e4', title: 'Zero sales', event_date: '2026-07-07' },
      { id: 'e5', title: 'No date', event_date: null },
    ],
    metrics: [
      metricsRow(),
      metricsRow({ event_id: 'e3', status: 'not_configured' }),
      metricsRow({ event_id: 'e4', gross_cents: 0 }),
      metricsRow({ event_id: 'e5' }),
    ],
    accountId: ACCOUNT,
  });
  assert.deepEqual(rows.map((r) => r.linked_event_id), ['e1']);
  assert.deepEqual(skipped, { noMetrics: 1, notOk: 1, zero: 1, noDate: 1 });
});

test('buildTicketTailorLedgerRows derives net when the cache has none', () => {
  const { rows } = buildTicketTailorLedgerRows({
    events: [EVENT],
    metrics: [metricsRow({ net_cents: null })],
    accountId: ACCOUNT,
  });
  assert.equal(rows[0].metadata.net_cents, 47500);
});

test('buildTicketTailorLedgerRows refuses to run without an account', () => {
  assert.throws(
    () => buildTicketTailorLedgerRows({ events: [EVENT], metrics: [metricsRow()] }),
    /requires an accountId/,
  );
});

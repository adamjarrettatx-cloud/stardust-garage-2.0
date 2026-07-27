import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountToCents,
  buildTicketTailorLedgerRows,
  centsToAmount,
  currentMonthRange,
  filterTransactions,
  monthlyOperatingPnl,
  monthlyTrend,
  monthsAgoStart,
  normalizeTransaction,
  summarizeByAccount,
  summarizeByCategory,
  summarizeFinancing,
  summarizeOperating,
  toDateOnly,
  UNCATEGORIZED,
  yearToDateRange,
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

test('summarizeOperating nets revenue against operating expense', () => {
  const result = summarizeOperating([
    txn({ id: 'a', amount: '100.00', direction: 'in' }),
    txn({ id: 'b', amount: '25.50', direction: 'out' }),
  ]);
  assert.equal(result.revenueCents, 10000);
  assert.equal(result.expenseCents, 2550);
  assert.equal(result.netCents, 7450);
  assert.equal(result.counted, 2);
});

// The bug this replaced: owner capital was landing in "Money in" and reading as
// revenue, so the dashboard could show a profit on a month that lost money.
test('summarizeOperating keeps financing out of the P&L entirely', () => {
  const result = summarizeOperating([
    txn({ id: 'a', amount: '100.00', direction: 'in' }),
    txn({ id: 'b', amount: '50000.00', direction: 'in', txn_type: 'financing', category: 'Owner Contribution' }),
    txn({ id: 'c', amount: '900.00', direction: 'out', txn_type: 'financing', category: 'Owner Draw' }),
  ]);
  assert.equal(result.revenueCents, 10000);
  assert.equal(result.expenseCents, 0);
  assert.equal(result.netCents, 10000);
  assert.equal(result.counted, 1);
});

// Transfers move money between the business's own accounts. They are neither P&L
// nor financing, which is the whole reason txn_type exists.
test('summarizeOperating and summarizeFinancing both ignore transfers', () => {
  const rows = [
    txn({ id: 'a', amount: '100.00', direction: 'in' }),
    txn({ id: 'b', amount: '500.00', direction: 'out', txn_type: 'transfer' }),
    txn({ id: 'c', amount: '500.00', direction: 'in', txn_type: 'transfer' }),
  ];
  assert.equal(summarizeOperating(rows).counted, 1);
  assert.equal(summarizeOperating(rows).revenueCents, 10000);
  assert.equal(summarizeFinancing(rows).counted, 0);
  assert.equal(summarizeFinancing(rows).netCents, 0);
});

// Amounts throughout this file are synthetic and chosen to make the arithmetic
// easy to read. The one exception is the owner-contribution figure below, which
// is the real 2026 YTD total because that is the number the P&L separation was
// built to stop counting as revenue. Nothing here samples the production ledger,
// so no total in this file should be read as a real revenue or expense figure.
test('summarizeFinancing separates contributions from draws', () => {
  const result = summarizeFinancing([
    txn({ id: 'a', amount: '184543.04', direction: 'in', txn_type: 'financing', category: 'Owner Contribution' }),
    txn({ id: 'b', amount: '2000.00', direction: 'out', txn_type: 'financing', category: 'Owner Draw' }),
    // Operating rows must not leak the other way either.
    txn({ id: 'c', amount: '75.00', direction: 'in' }),
  ]);
  assert.equal(result.contributionsCents, 18454304);
  assert.equal(result.distributionsCents, 200000);
  assert.equal(result.netCents, 18254304);
  assert.equal(result.counted, 2);
});

test('monthlyOperatingPnl carries a running cumulative net across months', () => {
  const buckets = monthlyOperatingPnl(
    [
      txn({ id: 'a', transaction_date: '2026-01-10', amount: '1000.00', direction: 'in' }),
      txn({ id: 'b', transaction_date: '2026-01-20', amount: '400.00', direction: 'out' }),
      // February loses money, so the cumulative total has to fall.
      txn({ id: 'c', transaction_date: '2026-02-05', amount: '100.00', direction: 'in' }),
      txn({ id: 'd', transaction_date: '2026-02-06', amount: '900.00', direction: 'out' }),
      // Financing must not move the P&L in any month.
      txn({ id: 'e', transaction_date: '2026-02-07', amount: '50000.00', direction: 'in', txn_type: 'financing' }),
      txn({ id: 'f', transaction_date: '2026-03-01', amount: '250.00', direction: 'in' }),
    ],
    { start: '2026-01-01', end: '2026-03-31' },
  );
  assert.deepEqual(buckets.map((b) => b.key), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(buckets.map((b) => b.netCents), [60000, -80000, 25000]);
  assert.deepEqual(buckets.map((b) => b.cumulativeNetCents), [60000, -20000, 5000]);
  assert.equal(buckets[0].label, 'Jan 2026');
});

// A month with no activity inside the span is a real flat month: the running
// total must carry across it rather than the row disappearing.
test('monthlyOperatingPnl emits empty months inside the span', () => {
  const buckets = monthlyOperatingPnl(
    [
      txn({ id: 'a', transaction_date: '2026-01-10', amount: '500.00', direction: 'in' }),
      txn({ id: 'b', transaction_date: '2026-03-10', amount: '200.00', direction: 'out' }),
    ],
    { start: '2026-01-01', end: '2026-03-31' },
  );
  assert.deepEqual(buckets.map((b) => b.key), ['2026-01', '2026-02', '2026-03']);
  assert.equal(buckets[1].netCents, 0);
  assert.deepEqual(buckets.map((b) => b.cumulativeNetCents), [50000, 50000, 30000]);
});

// The range picker accepts any date. Buckets clamp to the months that actually
// hold operating rows so a stray year cannot render a thousand empty rows.
test('monthlyOperatingPnl clamps the span to months holding operating rows', () => {
  const buckets = monthlyOperatingPnl(
    [txn({ id: 'a', transaction_date: '2026-06-10', amount: '500.00', direction: 'in' })],
    { start: '1900-01-01', end: '2026-12-31' },
  );
  assert.deepEqual(buckets.map((b) => b.key), ['2026-06']);
});

test('monthlyOperatingPnl is empty when the window holds no operating rows', () => {
  const financingOnly = [txn({ id: 'a', transaction_date: '2026-02-01', txn_type: 'financing', direction: 'in' })];
  assert.deepEqual(monthlyOperatingPnl(financingOnly, { start: '2026-01-01', end: '2026-12-31' }), []);
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

test('summarizeByCategory groups by category and sorts by total activity', () => {
  const rows = summarizeByCategory(
    [
      txn({ id: 'a', amount: '10.00', category: 'Ticket Revenue' }),
      txn({ id: 'b', amount: '90.00', category: 'Rent' }),
      txn({ id: 'c', amount: '5.00', direction: 'out', category: 'Rent' }),
      // Transfers are excluded from every total, exactly as in summarizeByAccount.
      txn({ id: 'd', amount: '500.00', txn_type: 'transfer', category: 'Rent' }),
    ],
    [{ id: ACCOUNT, name: 'TicketTailor', account_type: 'ticketing' }],
  );
  assert.deepEqual(rows.map((r) => r.category), ['Rent', 'Ticket Revenue']);
  assert.equal(rows[0].inflowCents, 9000);
  assert.equal(rows[0].outflowCents, 500);
  assert.equal(rows[0].netCents, 8500);
  assert.equal(rows[0].activityCents, 9500);
  assert.equal(rows[0].count, 2);
});

test('summarizeByCategory carries each bucket rows with a resolved account name', () => {
  const [bucket] = summarizeByCategory(
    [txn({ id: 'a', amount: '10.00', category: 'Owner Contribution' })],
    [{ id: ACCOUNT, name: 'TicketTailor', account_type: 'ticketing' }],
  );
  assert.deepEqual(bucket.transactions.map((r) => r.id), ['a']);
  assert.equal(bucket.transactions[0].accountName, 'TicketTailor');
});

test('summarizeByCategory buckets null categories under Uncategorized', () => {
  const rows = summarizeByCategory([txn({ id: 'a', category: null })], []);
  assert.equal(rows[0].category, UNCATEGORIZED);
  assert.equal(rows[0].transactions[0].accountName, 'Unknown account');
});

test('yearToDateRange runs from Jan 1 through today', () => {
  assert.deepEqual(yearToDateRange(new Date(2026, 6, 26)), { start: '2026-01-01', end: '2026-07-26' });
  assert.deepEqual(yearToDateRange(new Date(2026, 0, 1)), { start: '2026-01-01', end: '2026-01-01' });
});

// The default window must never reach past what the page actually fetched, or the
// dashboard would silently under-report its own default range.
test('yearToDateRange stays inside the 12 months the page loads', () => {
  for (const month of [0, 5, 11]) {
    const today = new Date(2026, month, 15);
    assert.ok(yearToDateRange(today).start >= monthsAgoStart(12, today));
  }
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

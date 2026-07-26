import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPreview,
  buildSpotOnLedgerRows,
  deriveRowAmountCents,
  mapSpotOnRows,
  parseSpotOnCsv,
  parseSpotOnDate,
  sanitizeMapping,
  suggestMapping,
  summarizeImport,
  validateMapping,
} from '../lib/spoton-import.js';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const BATCH = '22222222-2222-4222-8222-222222222222';

const CSV = [
  'Business Date,Gross Sales,Tips,Refunds,Processing Fees,Net Deposit',
  '07/01/2026,"$1,200.00",$150.00,$0.00,$36.00,"$1,314.00"',
  '07/02/2026,$800.00,$90.00,$50.00,$24.00,$816.00',
].join('\n');

// --- Parsing ----------------------------------------------------------------

test('parseSpotOnCsv keys each row by its header', () => {
  const { headers, rows, error } = parseSpotOnCsv(CSV);
  assert.equal(error, null);
  assert.deepEqual(headers, ['Business Date', 'Gross Sales', 'Tips', 'Refunds', 'Processing Fees', 'Net Deposit']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]['Net Deposit'], '$1,314.00');
});

test('parseSpotOnCsv reports unusable files instead of throwing', () => {
  assert.match(parseSpotOnCsv('').error, /empty/i);
  assert.match(parseSpotOnCsv('Date,Amount').error, /no data rows/i);
});

// Rows are keyed by header name, so a duplicate or blank header would silently
// overwrite a column.
test('parseSpotOnCsv makes duplicate and blank headers distinct', () => {
  const { headers } = parseSpotOnCsv('Date,Amount,Amount,\n1,2,3,4');
  assert.deepEqual(headers, ['Date', 'Amount', 'Amount (2)', 'Column 4']);
});

test('parseSpotOnDate reads a calendar date without going through an instant', () => {
  assert.equal(parseSpotOnDate('2026-07-01'), '2026-07-01');
  assert.equal(parseSpotOnDate('7/1/2026'), '2026-07-01');
  assert.equal(parseSpotOnDate('07/01/26'), '2026-07-01');
  assert.equal(parseSpotOnDate('7/1/2026 11:45 PM'), '2026-07-01');
  assert.equal(parseSpotOnDate('2026-07-01T23:45:00Z'), '2026-07-01');
  assert.equal(parseSpotOnDate(''), null);
  assert.equal(parseSpotOnDate('whenever'), null);
});

// --- Mapping ----------------------------------------------------------------

test('suggestMapping proposes a mapping and claims each column once', () => {
  const { headers } = parseSpotOnCsv(CSV);
  const mapping = suggestMapping(headers);
  assert.equal(mapping.date, 'Business Date');
  assert.equal(mapping.net_deposit, 'Net Deposit');
  assert.equal(mapping.gross_sales, 'Gross Sales');
  assert.equal(mapping.fees, 'Processing Fees');
  const claimed = Object.values(mapping);
  assert.equal(new Set(claimed).size, claimed.length);
});

// An unrecognized export must still be importable by hand — the flow may not
// assume any particular SpotOn layout.
test('suggestMapping leaves unknown layouts unmapped rather than guessing wrong', () => {
  const mapping = suggestMapping(['col_a', 'col_b']);
  assert.deepEqual(mapping, {});
});

test('validateMapping requires a date column and a base amount column', () => {
  const headers = ['Business Date', 'Gross Sales', 'Tips'];
  assert.equal(validateMapping({ date: 'Business Date', gross_sales: 'Gross Sales' }, headers).valid, true);

  assert.match(validateMapping({ gross_sales: 'Gross Sales' }, headers).errors.date, /date/i);
  assert.match(validateMapping({ date: 'Business Date' }, headers).errors.amount, /at least one amount/i);
  // Tips alone cannot say how much money moved.
  assert.match(validateMapping({ date: 'Business Date', tips: 'Tips' }, headers).errors.amount, /gross sales/i);
  // A column that isn't in the file is rejected rather than silently ignored.
  assert.match(validateMapping({ date: 'Nope', gross_sales: 'Gross Sales' }, headers).errors.date, /not a column/i);
});

test('sanitizeMapping keeps only known field keys', () => {
  assert.deepEqual(
    sanitizeMapping({ date: ' Business Date ', gross_sales: 'Gross Sales', evil: 'drop me', tips: '' }),
    { date: 'Business Date', gross_sales: 'Gross Sales' },
  );
});

// --- Amount derivation ------------------------------------------------------

test('deriveRowAmountCents prefers a mapped net deposit', () => {
  const { rows } = parseSpotOnCsv(CSV);
  const result = deriveRowAmountCents(rows[0], { net_deposit: 'Net Deposit', gross_sales: 'Gross Sales' });
  assert.equal(result.amountCents, 131400);
  assert.equal(result.basis, 'net_deposit');
});

test('deriveRowAmountCents falls back to gross + tips - refunds - fees', () => {
  const { rows } = parseSpotOnCsv(CSV);
  const mapping = { gross_sales: 'Gross Sales', tips: 'Tips', refunds: 'Refunds', fees: 'Processing Fees' };
  assert.equal(deriveRowAmountCents(rows[1], mapping).amountCents, 80000 + 9000 - 5000 - 2400);
  assert.equal(deriveRowAmountCents(rows[1], mapping).basis, 'gross_derived');
});

// An export that writes refunds/fees as negatives must not flip a subtraction
// into an addition.
test('deriveRowAmountCents treats refunds and fees as magnitudes', () => {
  const row = { G: '100.00', R: '-10.00', F: '(5.00)' };
  const result = deriveRowAmountCents(row, { gross_sales: 'G', refunds: 'R', fees: 'F' });
  assert.equal(result.amountCents, 8500);
});

test('deriveRowAmountCents yields zero when no amount column is mapped', () => {
  assert.equal(deriveRowAmountCents({ G: '100.00' }, { date: 'D' }).amountCents, 0);
});

// --- Row mapping ------------------------------------------------------------

test('mapSpotOnRows produces one dated inflow per row', () => {
  const { rows } = parseSpotOnCsv(CSV);
  const { mapped, errors, skippedZero } = mapSpotOnRows(rows, { date: 'Business Date', net_deposit: 'Net Deposit' });
  assert.equal(errors.length, 0);
  assert.equal(skippedZero, 0);
  assert.deepEqual(mapped.map((r) => r.date), ['2026-07-01', '2026-07-02']);
  assert.deepEqual(mapped.map((r) => r.direction), ['in', 'in']);
  assert.equal(mapped[0].amountCents, 131400);
});

// Refunds exceeding sales is real money leaving the business, not a clamp-to-zero.
test('mapSpotOnRows records a net-negative day as an outflow', () => {
  const rows = [{ D: '2026-07-03', G: '10.00', R: '60.00' }];
  const { mapped } = mapSpotOnRows(rows, { date: 'D', gross_sales: 'G', refunds: 'R' });
  assert.equal(mapped[0].direction, 'out');
  assert.equal(mapped[0].amountCents, 5000);
});

test('mapSpotOnRows reports undated rows and drops zero-amount rows', () => {
  const rows = [
    { D: 'garbage', G: '10.00' },
    { D: '2026-07-03', G: '0.00' },
    { D: '2026-07-04', G: '10.00' },
  ];
  const { mapped, errors, skippedZero } = mapSpotOnRows(rows, { date: 'D', gross_sales: 'G' });
  assert.equal(mapped.length, 1);
  assert.equal(skippedZero, 1);
  assert.deepEqual(errors.map((e) => e.rowIndex), [0]);
});

// --- Ledger rows ------------------------------------------------------------

test('buildSpotOnLedgerRows makes each row traceable to its batch and CSV line', () => {
  const { rows } = parseSpotOnCsv(CSV);
  const mapping = { date: 'Business Date', net_deposit: 'Net Deposit' };
  const { mapped } = mapSpotOnRows(rows, mapping);
  const ledger = buildSpotOnLedgerRows({ mapped, accountId: ACCOUNT, batchId: BATCH, createdBy: 'user-1', mapping });

  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].account_id, ACCOUNT);
  assert.equal(ledger[0].amount, '1314.00');
  assert.equal(ledger[0].direction, 'in');
  assert.equal(ledger[0].txn_type, 'operating');
  assert.equal(ledger[0].category, 'POS Revenue');
  assert.equal(ledger[0].source, 'spoton_csv');
  assert.equal(ledger[0].external_ref, `${BATCH}:0`);
  assert.equal(ledger[1].external_ref, `${BATCH}:1`);
  assert.equal(ledger[0].import_batch_id, BATCH);
  // The untouched CSV row is preserved for a phase-2 breakdown.
  assert.equal(ledger[0].metadata.raw_row['Gross Sales'], '$1,200.00');
});

test('buildSpotOnLedgerRows labels an outflow row honestly', () => {
  const mapped = [{ rowIndex: 0, date: '2026-07-03', amountCents: 5000, direction: 'out', basis: 'gross_derived', breakdown: {}, raw: {} }];
  const ledger = buildSpotOnLedgerRows({ mapped, accountId: ACCOUNT, batchId: BATCH });
  assert.equal(ledger[0].category, 'POS Refunds');
  assert.equal(ledger[0].direction, 'out');
});

test('buildSpotOnLedgerRows refuses to run without an account or batch', () => {
  assert.throws(() => buildSpotOnLedgerRows({ mapped: [], batchId: BATCH }), /accountId/);
  assert.throws(() => buildSpotOnLedgerRows({ mapped: [], accountId: ACCOUNT }), /batchId/);
});

// --- Preview / summary ------------------------------------------------------

test('buildPreview returns headers, a suggestion, and a capped row sample', () => {
  const preview = buildPreview(CSV, { maxRows: 1 });
  assert.equal(preview.error, null);
  assert.equal(preview.rowCount, 2);
  assert.equal(preview.previewRows.length, 1);
  assert.equal(preview.suggestedMapping.date, 'Business Date');
  // The full row set is still returned so the route can persist it.
  assert.equal(preview.rows.length, 2);
});

test('summarizeImport separates inflow from outflow', () => {
  const summary = summarizeImport([
    { direction: 'in', amountCents: 10000 },
    { direction: 'out', amountCents: 2500 },
  ]);
  assert.deepEqual(summary, { rows: 2, inflowCents: 10000, outflowCents: 2500, netCents: 7500 });
});

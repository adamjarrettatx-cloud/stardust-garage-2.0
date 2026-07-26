import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGGREGATION,
  buildPreview,
  buildSpotOnLedgerRows,
  detectItemizedExport,
  deriveRowAmountCents,
  isYes,
  mapSpotOnRows,
  parseSpotOnCsv,
  parseSpotOnDate,
  resolveAggregation,
  sanitizeMapping,
  suggestAggregation,
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

// Synthetic fixture mirroring the column set and row-level behaviors of a real
// SpotOn "order item list view" export: one row per sold item, NO
// fees/tips/net-deposit column anywhere, a voided line already zeroed with its
// amount parked in Voided Sales Amount, and a refund line already negative.
const ITEM_HEADERS = [
  'Item Name', 'Item ID', 'Menu Item ID', 'Category', 'Employee Name', 'Added Date', 'Added Time',
  'Is Void', 'Void Reason', 'Quantity', 'Menu Item Price', 'Taxes', 'Gross Sales', 'Discounts',
  'Net Sales', 'Voided Sales Amount', 'Order ID', 'Order Number', 'Is Refund',
].join(',');

function itemRow({ date, category, taxes, gross, discounts, net, voided = '0.0', isVoid = 'No', isRefund = 'No' }) {
  return [
    'Item', '1-0', '1469428', category, 'Employees General', date, '5:50 AM',
    isVoid, '', '1.0', gross, taxes, gross, discounts,
    net, voided, '28205530', 'A000081', isRefund,
  ].join(',');
}

const ITEM_CSV = [
  ITEM_HEADERS,
  itemRow({ date: '2026-07-01', category: 'Tickets', taxes: '0.0', gross: '50.0', discounts: '0.0', net: '50.0' }),
  itemRow({ date: '2026-07-01', category: 'Beverages', taxes: '0.41', gross: '5.0', discounts: '0.0', net: '5.0' }),
  itemRow({ date: '2026-07-01', category: 'Beverages', taxes: '0.25', gross: '4.0', discounts: '1.0', net: '3.0' }),
  // Voided line: already zeroed, the would-be amount sits in Voided Sales Amount.
  itemRow({ date: '2026-07-01', category: 'Lockers', taxes: '0.0', gross: '0.0', discounts: '0.0', net: '0.0', voided: '10.0', isVoid: 'Yes' }),
  itemRow({ date: '2026-07-02', category: 'Tickets', taxes: '0.0', gross: '100.0', discounts: '0.0', net: '100.0' }),
  // Refund line: already negative.
  itemRow({ date: '2026-07-02', category: 'Tickets', taxes: '0.0', gross: '-50.0', discounts: '0.0', net: '-50.0', isRefund: 'Yes' }),
].join('\n');

const ITEM_HEADER_LIST = parseSpotOnCsv(ITEM_CSV).headers;
const ITEM_ROWS = parseSpotOnCsv(ITEM_CSV).rows;
const ITEM_MAPPING = suggestMapping(ITEM_HEADER_LIST);

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
  const mapped = [{ refKey: '0', date: '2026-07-03', amountCents: 5000, direction: 'out', basis: 'gross_derived', metadata: {} }];
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
  assert.deepEqual(summary, { rows: 2, lineItems: 2, inflowCents: 10000, outflowCents: 2500, netCents: 7500 });
});

// --- Itemized exports -------------------------------------------------------

test('detectItemizedExport recognizes an item-level export, not a daily batch', () => {
  assert.equal(detectItemizedExport(ITEM_HEADER_LIST), true);
  assert.equal(suggestAggregation(ITEM_HEADER_LIST), AGGREGATION.daily);

  const { headers } = parseSpotOnCsv(CSV);
  assert.equal(detectItemizedExport(headers), false);
  assert.equal(suggestAggregation(headers), AGGREGATION.row);
});

test('isYes reads the export\'s Yes/No flags without treating text as truthy', () => {
  assert.equal(isYes('Yes'), true);
  assert.equal(isYes('No'), false);
  assert.equal(isYes(''), false);
  assert.equal(isYes(undefined), false);
});

// The real export has no fees/tips/net-deposit column anywhere, so the amount
// has to come from Net Sales — and the Yes/No flag columns must not be mistaken
// for amounts.
test('suggestMapping maps an item-level export to net sales and its breakdown columns', () => {
  assert.equal(ITEM_MAPPING.date, 'Added Date');
  assert.equal(ITEM_MAPPING.net_sales, 'Net Sales');
  assert.equal(ITEM_MAPPING.gross_sales, 'Gross Sales');
  assert.equal(ITEM_MAPPING.taxes, 'Taxes');
  assert.equal(ITEM_MAPPING.discounts, 'Discounts');
  assert.equal(ITEM_MAPPING.item_category, 'Category');
  assert.equal(ITEM_MAPPING.is_void, 'Is Void');
  assert.equal(ITEM_MAPPING.is_refund, 'Is Refund');
  assert.equal(ITEM_MAPPING.voided_amount, 'Voided Sales Amount');
  assert.equal(ITEM_MAPPING.net_deposit, undefined);
  assert.equal(ITEM_MAPPING.refunds, undefined);
  assert.equal(ITEM_MAPPING.fees, undefined);
  assert.equal(ITEM_MAPPING.tips, undefined);
  assert.equal(validateMapping(ITEM_MAPPING, ITEM_HEADER_LIST).valid, true);
});

// --- Daily aggregation ------------------------------------------------------

test('mapSpotOnRows sums line items into one row per calendar date', () => {
  const { mapped, skippedZero, errors } = mapSpotOnRows(ITEM_ROWS, ITEM_MAPPING, { aggregation: AGGREGATION.daily });
  assert.equal(errors.length, 0);
  assert.equal(skippedZero, 0);
  assert.deepEqual(mapped.map((r) => r.date), ['2026-07-01', '2026-07-02']);
  // 50 + 5 + 3, and the voided line contributes nothing because it is already zeroed.
  assert.equal(mapped[0].amountCents, 5800);
  assert.equal(mapped[0].direction, 'in');
  assert.equal(mapped[0].rowCount, 4);
  // 100 - 50: the refund line is already negative, so it nets out.
  assert.equal(mapped[1].amountCents, 5000);
  assert.equal(mapped[1].rowCount, 2);
  assert.equal(mapped[0].basis, 'net_sales');
});

test('daily aggregation keeps taxes out of the amount and in metadata', () => {
  const { mapped } = mapSpotOnRows(ITEM_ROWS, ITEM_MAPPING, { aggregation: AGGREGATION.daily });
  const meta = mapped[0].metadata;
  assert.equal(meta.taxes_cents, 66);
  assert.equal(mapped[0].amountCents, 5800);
  assert.equal(meta.discounts_cents, 100);
  assert.equal(meta.gross_sales_cents, 5900);
  assert.equal(meta.voided_amount_cents, 1000);
  assert.equal(meta.line_item_count, 4);
  assert.equal(meta.aggregation, AGGREGATION.daily);
});

test('daily aggregation counts void and refund lines instead of re-excluding them', () => {
  const { mapped } = mapSpotOnRows(ITEM_ROWS, ITEM_MAPPING, { aggregation: AGGREGATION.daily });
  assert.equal(mapped[0].metadata.void_row_count, 1);
  assert.equal(mapped[0].metadata.refund_row_count, 0);
  assert.equal(mapped[1].metadata.void_row_count, 0);
  assert.equal(mapped[1].metadata.refund_row_count, 1);
});

test('daily aggregation subtotals each item category', () => {
  const { mapped } = mapSpotOnRows(ITEM_ROWS, ITEM_MAPPING, { aggregation: AGGREGATION.daily });
  assert.deepEqual(mapped[0].metadata.categories, { Tickets: 5000, Beverages: 800, Lockers: 0 });
  assert.deepEqual(mapped[1].metadata.categories, { Tickets: 5000 });
});

test('a date whose line items cancel out is skipped, not written as a zero row', () => {
  const rows = [
    { D: '2026-07-05', N: '40.00' },
    { D: '2026-07-05', N: '-40.00' },
    { D: '2026-07-06', N: '10.00' },
  ];
  const { mapped, skippedZero } = mapSpotOnRows(rows, { date: 'D', net_sales: 'N' }, { aggregation: AGGREGATION.daily });
  assert.deepEqual(mapped.map((r) => r.date), ['2026-07-06']);
  assert.equal(skippedZero, 1);
});

test('a date that nets negative is recorded as an outflow', () => {
  const rows = [
    { D: '2026-07-05', N: '10.00' },
    { D: '2026-07-05', N: '-60.00' },
  ];
  const { mapped } = mapSpotOnRows(rows, { date: 'D', net_sales: 'N' }, { aggregation: AGGREGATION.daily });
  assert.equal(mapped[0].direction, 'out');
  assert.equal(mapped[0].amountCents, 5000);
});

test('aggregated ledger rows are keyed by date so a re-import updates in place', () => {
  const { mapped } = mapSpotOnRows(ITEM_ROWS, ITEM_MAPPING, { aggregation: AGGREGATION.daily });
  const ledger = buildSpotOnLedgerRows({ mapped, accountId: ACCOUNT, batchId: BATCH, mapping: ITEM_MAPPING });
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].external_ref, `${BATCH}:2026-07-01`);
  assert.equal(ledger[0].amount, '58.00');
  assert.equal(ledger[0].category, 'POS Revenue');
  assert.equal(ledger[0].metadata.column_mapping.net_sales, 'Net Sales');
});

test('summarizeImport reports the line-item count behind aggregated rows', () => {
  const { mapped } = mapSpotOnRows(ITEM_ROWS, ITEM_MAPPING, { aggregation: AGGREGATION.daily });
  const summary = summarizeImport(mapped);
  assert.equal(summary.rows, 2);
  assert.equal(summary.lineItems, 6);
  assert.equal(summary.inflowCents, 10800);
});

// The per-row path has to stay available for a genuinely daily/batch export.
test('the per-row mode still maps an itemized file straight through', () => {
  const { mapped } = mapSpotOnRows(ITEM_ROWS, ITEM_MAPPING, { aggregation: AGGREGATION.row });
  assert.equal(mapped.length, 5); // the zeroed void line drops out
  assert.equal(mapped[0].metadata.aggregation, AGGREGATION.row);
});

test('resolveAggregation falls back to the shape implied by the headers', () => {
  assert.equal(resolveAggregation('row', ITEM_HEADER_LIST), AGGREGATION.row);
  assert.equal(resolveAggregation('nonsense', ITEM_HEADER_LIST), AGGREGATION.daily);
  assert.equal(resolveAggregation(undefined, parseSpotOnCsv(CSV).headers), AGGREGATION.row);
});

test('buildPreview suggests daily aggregation for an item-level export', () => {
  const preview = buildPreview(ITEM_CSV);
  assert.equal(preview.itemized, true);
  assert.equal(preview.suggestedAggregation, AGGREGATION.daily);
  assert.equal(buildPreview(CSV).suggestedAggregation, AGGREGATION.row);
});

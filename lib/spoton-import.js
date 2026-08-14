// Pure helpers for the manual SpotOn POS CSV import.
//
// No I/O and no deps beyond lib/pos-csv.js (the existing RFC-4180-ish parser
// and money normalizer, reused rather than re-implemented). The admin route
// reads the uploaded file, hands the text here for a preview, stores the parsed
// rows, and — on confirm — re-derives every amount from those STORED rows. The
// browser never supplies a total.
//
// Two export shapes are supported, because SpotOn's "order item list view" (the
// export we actually have) is one row per sold item, not one row per day:
//
//   'daily' — group rows by the mapped date column and write ONE ledger row per
//             calendar date. Auto-selected when an item-level export is
//             detected (see detectItemizedExport). The itemized detail that the
//             ledger row does not carry is summarized into its metadata.
//   'row'   — one ledger row per CSV row, for exports that genuinely are
//             already daily/batch/settlement level.
//
// Nothing here assumes a fixed column set either way: suggestMapping() only
// proposes, the admin decides, and an unrecognized layout still imports as long
// as a date column and one base amount column are picked by hand.

import { parseCsv, moneyToCents } from './pos-csv.js';
import { CATEGORY, centsToAmount } from './financial-ledger.js';

export const AGGREGATION = { daily: 'daily', row: 'row' };

// The fields a SpotOn column can be mapped to.
//
// `amount` fields feed the ledger amount. `breakdown` and `dimension` fields are
// captured in metadata only and never move the amount — sales tax in particular
// is a later phase, so Taxes is deliberately not addable to a ledger total.
// `flag` fields are Yes/No columns counted for the metadata summary.
export const SPOTON_FIELDS = [
  { key: 'date', label: 'Date', kind: 'date', required: true, hint: 'Business/transaction date for the row' },
  { key: 'net_deposit', label: 'Net deposit', kind: 'amount', hint: 'Settlement total on a batch export — wins over every other amount' },
  { key: 'net_sales', label: 'Net sales', kind: 'amount', hint: 'Net after discounts — the amount column on an item-level export' },
  { key: 'gross_sales', label: 'Gross sales', kind: 'amount', hint: 'Used when there is no net deposit or net sales column' },
  { key: 'tips', label: 'Tips', kind: 'amount', hint: 'Added to gross when the amount is derived from gross' },
  { key: 'refunds', label: 'Refunds', kind: 'amount', hint: 'Subtracted from gross when the amount is derived from gross' },
  { key: 'fees', label: 'Fees', kind: 'amount', hint: 'Subtracted from gross when the amount is derived from gross' },
  { key: 'taxes', label: 'Taxes', kind: 'breakdown', hint: 'Metadata only — sales tax is never added to the ledger amount' },
  { key: 'discounts', label: 'Discounts', kind: 'breakdown', hint: 'Metadata only' },
  { key: 'voided_amount', label: 'Voided sales amount', kind: 'breakdown', hint: 'Metadata only — what a voided line would have been' },
  { key: 'item_category', label: 'Item category', kind: 'dimension', hint: 'Per-category subtotals in metadata (Tickets, Beverages, …)' },
  { key: 'is_void', label: 'Is void', kind: 'flag', hint: 'Yes/No column — voided rows are counted in metadata' },
  { key: 'is_refund', label: 'Is refund', kind: 'flag', hint: 'Yes/No column — refund rows are counted in metadata' },
];

const keysOfKind = (kind) => SPOTON_FIELDS.filter((f) => f.kind === kind).map((f) => f.key);

export const SPOTON_FIELD_KEYS = SPOTON_FIELDS.map((f) => f.key);
export const AMOUNT_FIELD_KEYS = keysOfKind('amount');
export const BREAKDOWN_FIELD_KEYS = keysOfKind('breakdown');
export const FLAG_FIELD_KEYS = keysOfKind('flag');
// A base amount answers "how much money moved?" on its own. Tips/refunds/fees
// only modify a gross figure, so one of these is always required.
export const BASE_AMOUNT_KEYS = ['net_deposit', 'net_sales', 'gross_sales'];

// The real item-level export is 9,260 rows / 2.4MB for ~5.5 months, so a
// 12-month export needs materially more headroom than a daily batch file.
// This is enforced against the downloaded object server-side, not a request
// body, so it isn't constrained by Vercel's ~4.5MB serverless function body
// limit — the upload goes browser -> Supabase Storage -> this server. It
// matches the spoton-imports bucket's own file_size_limit (see the
// spoton_import_storage_bucket migration).
export const MAX_CSV_BYTES = 25 * 1024 * 1024;
export const MAX_CSV_ROWS = 50000;

// Private Supabase Storage bucket used to stage a raw CSV upload just long
// enough for the server to download and parse it. Objects are deleted right
// after the pending batch is created (or on failure) — this bucket is not a
// permanent archive.
export const SPOTON_IMPORT_BUCKET = 'spoton-imports';
export const PREVIEW_ROW_COUNT = 10;
// Guards the metadata jsonb: a mis-mapped free-text column must not turn into an
// unbounded per-category map.
export const MAX_METADATA_CATEGORIES = 60;

// Header substrings seen on POS exports. Only a starting suggestion — a wrong
// guess is corrected in the mapping UI before anything is written, and a header
// matching nothing simply leaves the field unmapped.
//
// Flag/breakdown hints are deliberately strict ("is refund", not "refund") so a
// Yes/No column is never mistaken for an amount column, and vice versa.
const HEADER_HINTS = {
  date: ['business date', 'transaction date', 'added date', 'date', 'day', 'datetime', 'created at', 'timestamp'],
  net_deposit: ['net deposit', 'net payout', 'net settlement', 'deposit', 'payout'],
  net_sales: ['net sales', 'net revenue', 'net amount'],
  gross_sales: ['gross sales', 'gross amount', 'gross', 'total sales', 'sales', 'subtotal', 'amount', 'total'],
  tips: ['tips', 'tip', 'gratuity'],
  refunds: ['refunds', 'refund amount', 'returns'],
  fees: ['processing fee', 'card fee', 'cc fee', 'fees', 'fee'],
  taxes: ['taxes', 'tax'],
  discounts: ['discounts', 'discount'],
  voided_amount: ['voided sales amount', 'voided amount', 'voided sales'],
  item_category: ['category', 'item category', 'menu category', 'department'],
  is_void: ['is void', 'is_void', 'voided'],
  is_refund: ['is refund', 'is_refund', 'refunded'],
};

// Resolution order for suggestMapping, most specific first. A header is claimed
// by at most one field, so the flag/breakdown columns of an item-level export
// must be resolved before the broad amount hints ("sales", "amount", "total")
// get a chance to swallow them.
const SUGGEST_ORDER = [
  'date',
  'is_void',
  'is_refund',
  'voided_amount',
  'item_category',
  'taxes',
  'discounts',
  'net_deposit',
  'net_sales',
  'gross_sales',
  'tips',
  'refunds',
  'fees',
];

function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase();
}

// Columns that only ever appear on a line-item export. "Net Sales" alone is not
// enough — a daily summary can carry it too — so we also require several
// per-item markers before switching the import to day-level aggregation.
const ITEMIZED_MARKERS = [
  'item name',
  'item id',
  'menu item id',
  'menu item price',
  'quantity',
  'order id',
  'order number',
  'is void',
  'is refund',
  'voided sales amount',
  'employee name',
];

// Is this a per-item export that has to be aggregated to become cash flow?
export function detectItemizedExport(headers = []) {
  const normalized = headers.map(normalizeHeader);
  const hasRowAmount = normalized.some((h) => h.includes('net sales') || h.includes('gross sales'));
  const markers = ITEMIZED_MARKERS.filter((m) => normalized.some((h) => h === m || h.includes(m))).length;
  return hasRowAmount && markers >= 3;
}

// One ledger row per date for a line-item export; one per CSV row otherwise.
export function suggestAggregation(headers = []) {
  return detectItemizedExport(headers) ? AGGREGATION.daily : AGGREGATION.row;
}

export function resolveAggregation(value, headers = []) {
  return value === AGGREGATION.daily || value === AGGREGATION.row ? value : suggestAggregation(headers);
}

// Propose a field -> header mapping from the detected header row. Each header is
// claimed by at most one field, exact match preferred over substring so
// "net deposit" wins over the bare "deposit" hint on the same column.
export function suggestMapping(headers = []) {
  const normalized = headers.map(normalizeHeader);
  const claimed = new Set();
  const mapping = {};
  for (const field of SUGGEST_ORDER) {
    for (const hint of HEADER_HINTS[field] || []) {
      const exact = normalized.findIndex((h, i) => !claimed.has(i) && h === hint);
      const idx = exact >= 0
        ? exact
        : normalized.findIndex((h, i) => !claimed.has(i) && h.includes(hint));
      if (idx >= 0) {
        claimed.add(idx);
        mapping[field] = headers[idx];
        break;
      }
    }
  }
  return mapping;
}

// Validate an admin-chosen mapping against the file's actual headers.
// Returns { valid, errors: { field: message } }.
export function validateMapping(mapping = {}, headers = []) {
  const errors = {};
  const known = new Set(headers.map(normalizeHeader));

  const dateHeader = mapping.date ? String(mapping.date) : '';
  if (!dateHeader.trim()) {
    errors.date = 'Pick the column holding the transaction date.';
  } else if (!known.has(normalizeHeader(dateHeader))) {
    errors.date = `"${dateHeader}" is not a column in this file.`;
  }

  // A column that isn't in the file is rejected rather than silently ignored,
  // for every field kind — a stale mapping must not quietly drop a breakdown.
  for (const key of SPOTON_FIELD_KEYS) {
    if (key === 'date') continue;
    const header = String(mapping[key] ?? '').trim();
    if (header && !known.has(normalizeHeader(header))) {
      errors[key] = `"${header}" is not a column in this file.`;
    }
  }

  if (!BASE_AMOUNT_KEYS.some((k) => String(mapping[k] ?? '').trim())) {
    errors.amount = AMOUNT_FIELD_KEYS.some((k) => String(mapping[k] ?? '').trim())
      ? 'Map net deposit, net sales, or gross sales — tips/refunds/fees alone cannot produce an amount.'
      : 'Map at least one amount column (net deposit, net sales, or gross sales).';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

// Keep only the known field keys, trimmed. Guards against an arbitrary client
// object being written into spoton_import_batches.column_mapping.
export function sanitizeMapping(mapping = {}) {
  const clean = {};
  for (const key of SPOTON_FIELD_KEYS) {
    const value = mapping?.[key];
    if (value == null) continue;
    const str = String(value).trim();
    if (str) clean[key] = str.slice(0, 200);
  }
  return clean;
}

// Parse a SpotOn date cell to YYYY-MM-DD, or null.
//
// Deliberately NOT lib/pos-csv.parsePosTimestamp: that returns a UTC instant,
// and taking the date part of an instant built from a local-midnight parse can
// land on the previous day. A ledger date is a plain calendar date, so we read
// the calendar fields directly and never construct an instant.
export function parseSpotOnDate(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (iso) return formatParts(iso[1], iso[2], iso[3]);

  // SpotOn's own "Business Date" column ships as a bare 8-digit YYYYMMDD
  // string with no separators (e.g. "20260809") — distinct from the
  // hyphenated "Added Date" column on the same export. new Date() does not
  // recognize this form (it comes back Invalid Date), so it needs its own
  // check before falling through to the generic parser below.
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (compact) return formatParts(compact[1], compact[2], compact[3]);

  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s);
  if (us) {
    let year = Number(us[3]);
    if (year < 100) year += 2000;
    return formatParts(year, us[1], us[2]);
  }

  // "Jul 1, 2026" and friends. Read back the local calendar fields rather than
  // serializing to UTC.
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return formatParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }
  return null;
}

function formatParts(y, m, d) {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Yes/No flag columns ("Is Void", "Is Refund").
export function isYes(value) {
  return /^(y|yes|true|t|1)$/i.test(String(value ?? '').trim());
}

// Parse CSV text into { headers, rows } where each row is a header-keyed
// object. Returns an `error` string instead of throwing on unusable input.
export function parseSpotOnCsv(text) {
  const parsed = parseCsv(text);
  if (parsed.length === 0) return { headers: [], rows: [], error: 'The file is empty.' };

  const headers = dedupeHeaders(parsed[0].map((h) => String(h ?? '').trim()));
  if (headers.every((h) => h === '')) return { headers: [], rows: [], error: 'No header row was detected.' };
  if (parsed.length < 2) return { headers, rows: [], error: 'The file has a header row but no data rows.' };
  if (parsed.length - 1 > MAX_CSV_ROWS) {
    return { headers, rows: [], error: `The file has more than ${MAX_CSV_ROWS.toLocaleString('en-US')} rows.` };
  }

  const rows = [];
  for (let r = 1; r < parsed.length; r++) {
    const cells = parsed[r];
    if (!cells || cells.every((v) => String(v ?? '').trim() === '')) continue;
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? null; });
    rows.push(row);
  }
  if (rows.length === 0) return { headers, rows: [], error: 'The file has a header row but no data rows.' };
  return { headers, rows, error: null };
}

// A duplicate or blank header would silently overwrite a column when rows are
// keyed by header name, so make every name distinct up front.
function dedupeHeaders(headers) {
  const seen = new Map();
  return headers.map((h, i) => {
    const base = h || `Column ${i + 1}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

// Everything the mapping step needs: detected columns, a suggested mapping and
// aggregation, and the first few rows to eyeball. Nothing is committed here.
export function buildPreview(text, { maxRows = PREVIEW_ROW_COUNT } = {}) {
  const { headers, rows, error } = parseSpotOnCsv(text);
  return {
    headers,
    rows,
    error,
    rowCount: rows.length,
    previewRows: rows.slice(0, maxRows),
    suggestedMapping: error ? {} : suggestMapping(headers),
    suggestedAggregation: error ? AGGREGATION.row : suggestAggregation(headers),
    itemized: error ? false : detectItemizedExport(headers),
  };
}

// Which mapped column answers "how much money moved?".
export function amountBasis(mapping = {}) {
  if (mapping.net_deposit) return 'net_deposit';
  if (mapping.net_sales) return 'net_sales';
  if (mapping.gross_sales) return 'gross_derived';
  return 'none';
}

// Derive one row's signed amount, in cents, from its mapped columns.
//
// A mapped net deposit is authoritative; then net sales (already net of
// discounts, and on a line-item export already zero for voids and negative for
// refunds, so it nets out on its own); otherwise gross + tips - refunds - fees.
// Refunds and fees are taken as magnitudes so an export that writes them as
// negatives ("-3.50") does not flip a subtraction into an addition. Taxes are
// never part of the amount.
export function deriveRowAmountCents(row, mapping) {
  const cell = (field) => (mapping[field] ? row[mapping[field]] : undefined);
  const has = (field) => Boolean(mapping[field]) && String(cell(field) ?? '').trim() !== '';

  const breakdown = {};
  for (const key of [...AMOUNT_FIELD_KEYS, ...BREAKDOWN_FIELD_KEYS]) {
    if (has(key)) breakdown[`${key}_cents`] = moneyToCents(cell(key));
  }

  const basis = amountBasis(mapping);
  if (basis === 'net_deposit') return { amountCents: breakdown.net_deposit_cents || 0, basis, breakdown };
  if (basis === 'net_sales') return { amountCents: breakdown.net_sales_cents || 0, basis, breakdown };
  if (basis === 'gross_derived') {
    const amountCents = (breakdown.gross_sales_cents || 0)
      + (breakdown.tips_cents || 0)
      - Math.abs(breakdown.refunds_cents || 0)
      - Math.abs(breakdown.fees_cents || 0);
    return { amountCents, basis, breakdown };
  }
  return { amountCents: 0, basis, breakdown };
}

// Map stored raw rows into ledger-ready values, either one per calendar date
// (aggregation 'daily') or one per CSV row (aggregation 'row').
export function mapSpotOnRows(rows = [], mapping = {}, { aggregation = AGGREGATION.row } = {}) {
  return aggregation === AGGREGATION.daily
    ? aggregateSpotOnRowsByDate(rows, mapping)
    : mapRowsIndividually(rows, mapping);
}

// One ledger row per CSV row. Rows that cannot yield a date are reported as
// errors rather than silently dropped, so the admin sees the count before
// confirming. A zero-amount row is skipped: it is not a money movement and a $0
// ledger entry is noise.
function mapRowsIndividually(rows, mapping) {
  const mapped = [];
  const errors = [];
  let skippedZero = 0;

  rows.forEach((row, index) => {
    const date = parseSpotOnDate(mapping.date ? row[mapping.date] : null);
    if (!date) {
      errors.push({ rowIndex: index, message: 'Could not read a date from the mapped date column.' });
      return;
    }
    const { amountCents, basis, breakdown } = deriveRowAmountCents(row, mapping);
    if (amountCents === 0) { skippedZero++; return; }
    mapped.push({
      refKey: String(index),
      rowIndex: index,
      date,
      // A net-negative row (a refund) is real money leaving the business, so it
      // becomes an outflow rather than being clamped to zero.
      amountCents: Math.abs(amountCents),
      direction: amountCents < 0 ? 'out' : 'in',
      basis,
      breakdown,
      raw: row,
      metadata: {
        aggregation: AGGREGATION.row,
        amount_basis: basis,
        ...breakdown,
        // The untouched CSV row, so a later tips/refunds/fees breakdown never
        // needs the original file again.
        raw_row: row,
      },
    });
  });

  return { mapped, errors, skippedZero, aggregation: AGGREGATION.row };
}

// One ledger row per calendar date, summing the mapped amount across every line
// item of that day.
//
// Nothing is filtered out on the way in. On the real export a voided line
// already carries 0 and a refund line already carries a negative, so summing
// the mapped amount nets both out with no special-casing — they are only
// *counted* for the metadata summary. `skippedZero` counts days whose lines
// cancelled out to exactly zero.
export function aggregateSpotOnRowsByDate(rows = [], mapping = {}) {
  const errors = [];
  const byDate = new Map();
  const basis = amountBasis(mapping);

  rows.forEach((row, index) => {
    const date = parseSpotOnDate(mapping.date ? row[mapping.date] : null);
    if (!date) {
      errors.push({ rowIndex: index, message: 'Could not read a date from the mapped date column.' });
      return;
    }

    let day = byDate.get(date);
    if (!day) {
      day = { date, amountCents: 0, rowCount: 0, totals: {}, categories: new Map(), voidRows: 0, refundRows: 0 };
      byDate.set(date, day);
    }

    const { amountCents, breakdown } = deriveRowAmountCents(row, mapping);
    day.rowCount += 1;
    day.amountCents += amountCents;
    for (const [key, cents] of Object.entries(breakdown)) {
      day.totals[key] = (day.totals[key] || 0) + cents;
    }
    if (mapping.is_void && isYes(row[mapping.is_void])) day.voidRows += 1;
    if (mapping.is_refund && isYes(row[mapping.is_refund])) day.refundRows += 1;
    if (mapping.item_category) {
      const name = categoryKey(row[mapping.item_category]);
      day.categories.set(name, (day.categories.get(name) || 0) + amountCents);
    }
  });

  const mapped = [];
  let skippedZero = 0;
  for (const day of [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    if (day.amountCents === 0) { skippedZero++; continue; }
    mapped.push({
      refKey: day.date,
      date: day.date,
      amountCents: Math.abs(day.amountCents),
      direction: day.amountCents < 0 ? 'out' : 'in',
      basis,
      rowCount: day.rowCount,
      metadata: {
        aggregation: AGGREGATION.daily,
        amount_basis: basis,
        // Every itemized figure the single ledger row cannot carry, so a later
        // sales-tax or per-category pass needs no re-import.
        line_item_count: day.rowCount,
        void_row_count: day.voidRows,
        refund_row_count: day.refundRows,
        ...day.totals,
        categories: capCategories(day.categories),
      },
    });
  }

  return { mapped, errors, skippedZero, aggregation: AGGREGATION.daily };
}

function categoryKey(value) {
  const name = String(value ?? '').trim();
  return name ? name.slice(0, 120) : 'Uncategorized';
}

// Largest categories win the cap so the summary stays useful, and the remainder
// is kept as a single bucket rather than silently vanishing.
function capCategories(categories) {
  const sorted = [...categories.entries()].sort((a, b) => b[1] - a[1]);
  const kept = sorted.slice(0, MAX_METADATA_CATEGORIES);
  const out = Object.fromEntries(kept.map(([name, cents]) => [name, cents]));
  const rest = sorted.slice(MAX_METADATA_CATEGORIES);
  if (rest.length > 0) {
    out['(other)'] = rest.reduce((sum, [, cents]) => sum + cents, 0);
  }
  return out;
}

// Turn mapped rows into public.financial_transactions inserts.
// external_ref is "<batch id>:<row index>" per-row, or "<batch id>:<date>" when
// aggregated. With source='spoton_csv' that satisfies the (source, external_ref)
// uniqueness index and keeps each ledger row traceable to a specific upload.
export function buildSpotOnLedgerRows({ mapped = [], accountId, batchId, createdBy = null, mapping = {} }) {
  if (!accountId) throw new Error('buildSpotOnLedgerRows requires an accountId');
  if (!batchId) throw new Error('buildSpotOnLedgerRows requires a batchId');

  return mapped.map((row) => ({
    account_id: accountId,
    transaction_date: row.date,
    amount: centsToAmount(row.amountCents),
    direction: row.direction,
    txn_type: 'operating',
    // Deliberately not fragmented into per-category ledger rows this phase: the
    // per-category split lives in metadata.categories.
    category: row.direction === 'out' ? CATEGORY.posRefund : CATEGORY.posRevenue,
    source: 'spoton_csv',
    external_ref: `${batchId}:${row.refKey}`,
    import_batch_id: batchId,
    metadata: { ...row.metadata, column_mapping: mapping },
    created_by: createdBy,
  }));
}

// Summarize a confirmed import for the response + the audit log entry.
export function summarizeImport(mapped = []) {
  let inflowCents = 0;
  let outflowCents = 0;
  let lineItems = 0;
  for (const row of mapped) {
    if (row.direction === 'out') outflowCents += row.amountCents;
    else inflowCents += row.amountCents;
    lineItems += row.rowCount || 1;
  }
  return { rows: mapped.length, lineItems, inflowCents, outflowCents, netCents: inflowCents - outflowCents };
}

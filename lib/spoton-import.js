// Pure helpers for the manual SpotOn POS CSV import.
//
// No I/O and no deps beyond lib/pos-csv.js (the existing RFC-4180-ish parser
// and money normalizer, reused rather than re-implemented). The admin route
// reads the uploaded file, hands the text here for a preview, stores the parsed
// rows, and — on confirm — re-derives every amount from those STORED rows. The
// browser never supplies a total.
//
// We do not have a confirmed SpotOn export sample yet, so nothing here assumes
// a fixed column set: suggestMapping() only proposes, the admin decides, and an
// unrecognized header layout still imports as long as a date column and one
// amount column are picked by hand.

import { parseCsv, moneyToCents } from './pos-csv.js';
import { CATEGORY, centsToAmount } from './financial-ledger.js';

// The fields a SpotOn column can be mapped to. `date` is always required; at
// least one `amount` field must be mapped (validateMapping enforces both).
export const SPOTON_FIELDS = [
  { key: 'date', label: 'Date', kind: 'date', required: true, hint: 'Business/transaction date for the row' },
  { key: 'net_deposit', label: 'Net deposit', kind: 'amount', hint: 'Preferred amount when present — what actually landed' },
  { key: 'gross_sales', label: 'Gross sales', kind: 'amount', hint: 'Used when there is no net deposit column' },
  { key: 'tips', label: 'Tips', kind: 'amount', hint: 'Added to gross when deriving the amount' },
  { key: 'refunds', label: 'Refunds', kind: 'amount', hint: 'Subtracted from gross when deriving the amount' },
  { key: 'fees', label: 'Fees', kind: 'amount', hint: 'Subtracted from gross when deriving the amount' },
];

export const SPOTON_FIELD_KEYS = SPOTON_FIELDS.map((f) => f.key);
export const AMOUNT_FIELD_KEYS = SPOTON_FIELDS.filter((f) => f.kind === 'amount').map((f) => f.key);

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 20000;
export const PREVIEW_ROW_COUNT = 10;

// Header substrings we have seen on POS exports generally. Only a starting
// suggestion — a wrong guess is corrected in the mapping UI before anything is
// written, and a header matching nothing simply leaves the field unmapped.
const HEADER_HINTS = {
  date: ['business date', 'transaction date', 'date', 'day', 'datetime', 'created at', 'timestamp'],
  net_deposit: ['net deposit', 'net payout', 'deposit', 'net total', 'net sales', 'net'],
  gross_sales: ['gross sales', 'gross amount', 'gross', 'total sales', 'sales', 'subtotal', 'amount', 'total'],
  tips: ['tips', 'tip', 'gratuity'],
  refunds: ['refunds', 'refund', 'returns', 'voids'],
  fees: ['processing fee', 'card fee', 'cc fee', 'fees', 'fee'],
};

function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase();
}

// Propose a field -> header mapping from the detected header row. Each header
// is claimed by at most one field, longest hint first so "net deposit" wins
// over the bare "net" hint on the same column.
export function suggestMapping(headers = []) {
  const normalized = headers.map(normalizeHeader);
  const claimed = new Set();
  const mapping = {};
  for (const field of SPOTON_FIELD_KEYS) {
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

  const mappedAmounts = AMOUNT_FIELD_KEYS.filter((k) => String(mapping[k] ?? '').trim());
  if (mappedAmounts.length === 0) {
    errors.amount = 'Map at least one amount column (net deposit, or gross sales).';
  }
  for (const key of mappedAmounts) {
    if (!known.has(normalizeHeader(mapping[key]))) {
      errors[key] = `"${mapping[key]}" is not a column in this file.`;
    }
  }
  // Tips/refunds/fees only modify a gross figure. On their own they cannot say
  // how much money moved, so require a base amount alongside them.
  if (!errors.amount && !mapping.net_deposit && !mapping.gross_sales) {
    errors.amount = 'Map net deposit or gross sales — tips/refunds/fees alone cannot produce an amount.';
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

// Everything the mapping step needs: detected columns, a suggested mapping, and
// the first few rows to eyeball. Nothing is committed at this stage.
export function buildPreview(text, { maxRows = PREVIEW_ROW_COUNT } = {}) {
  const { headers, rows, error } = parseSpotOnCsv(text);
  return {
    headers,
    rows,
    error,
    rowCount: rows.length,
    previewRows: rows.slice(0, maxRows),
    suggestedMapping: error ? {} : suggestMapping(headers),
  };
}

// Derive one row's signed amount, in cents, from its mapped columns.
//
// Preference order matches the spec: a mapped net deposit is authoritative;
// otherwise gross + tips - refunds - fees, using only the columns that were
// actually mapped. Refunds and fees are taken as magnitudes so an export that
// writes them as negatives ("-3.50") does not flip into an addition.
export function deriveRowAmountCents(row, mapping) {
  const cell = (field) => (mapping[field] ? row[mapping[field]] : undefined);
  const has = (field) => Boolean(mapping[field]) && String(cell(field) ?? '').trim() !== '';

  const breakdown = {};
  for (const key of AMOUNT_FIELD_KEYS) {
    if (has(key)) breakdown[`${key}_cents`] = moneyToCents(cell(key));
  }

  if (has('net_deposit')) {
    return { amountCents: breakdown.net_deposit_cents, basis: 'net_deposit', breakdown };
  }
  if (has('gross_sales')) {
    const amountCents = breakdown.gross_sales_cents
      + (breakdown.tips_cents || 0)
      - Math.abs(breakdown.refunds_cents || 0)
      - Math.abs(breakdown.fees_cents || 0);
    return { amountCents, basis: 'gross_derived', breakdown };
  }
  return { amountCents: 0, basis: 'none', breakdown };
}

// Map stored raw rows into ledger-ready values. Rows that cannot yield a date
// are reported as errors rather than silently dropped, so the admin sees the
// count before confirming. A zero-amount row is skipped: it is not a money
// movement and a $0 ledger entry is noise.
export function mapSpotOnRows(rows = [], mapping = {}) {
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
      rowIndex: index,
      date,
      // A net-negative day (refunds exceeding sales) is real money leaving the
      // business, so it becomes an outflow rather than being clamped to zero.
      amountCents: Math.abs(amountCents),
      direction: amountCents < 0 ? 'out' : 'in',
      basis,
      breakdown,
      raw: row,
    });
  });

  return { mapped, errors, skippedZero };
}

// Turn mapped rows into public.financial_transactions inserts.
// external_ref is "<batch id>:<row index>", which with source='spoton_csv'
// satisfies the (source, external_ref) uniqueness index and makes each ledger
// row traceable to a specific line of a specific upload.
export function buildSpotOnLedgerRows({ mapped = [], accountId, batchId, createdBy = null, mapping = {} }) {
  if (!accountId) throw new Error('buildSpotOnLedgerRows requires an accountId');
  if (!batchId) throw new Error('buildSpotOnLedgerRows requires a batchId');

  return mapped.map((row) => ({
    account_id: accountId,
    transaction_date: row.date,
    amount: centsToAmount(row.amountCents),
    direction: row.direction,
    txn_type: 'operating',
    category: row.direction === 'out' ? CATEGORY.posRefund : CATEGORY.posRevenue,
    source: 'spoton_csv',
    external_ref: `${batchId}:${row.rowIndex}`,
    import_batch_id: batchId,
    metadata: {
      amount_basis: row.basis,
      ...row.breakdown,
      column_mapping: mapping,
      // The untouched CSV row, so a phase-2 tips/refunds/fees breakdown never
      // needs the original file again.
      raw_row: row.raw,
    },
    created_by: createdBy,
  }));
}

// Summarize a confirmed import for the response + the audit log entry.
export function summarizeImport(mapped = []) {
  let inflowCents = 0;
  let outflowCents = 0;
  for (const row of mapped) {
    if (row.direction === 'out') outflowCents += row.amountCents;
    else inflowCents += row.amountCents;
  }
  return { rows: mapped.length, inflowCents, outflowCents, netCents: inflowCents - outflowCents };
}

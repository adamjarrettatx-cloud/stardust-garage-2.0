// Pure QuickBooks -> financial_transactions row mapping. No I/O — the sync
// route (app/api/admin/financial-ledger/sync-quickbooks/route.js) fetches the
// raw QBO objects via lib/quickbooks.js and hands them here, mirroring how
// buildTicketTailorLedgerRows works in lib/financial-ledger.js.
//
// CONTEXT: 834 QuickBooks rows already exist in the ledger from a one-time
// manual backfill (source='quickbooks', external_ref='qbo:{Type}:{Id}:{Line}').
// This module produces rows in the exact same shape/ref format so a recurring
// sync is idempotent alongside that history (writeLedgerRows matches on
// (source, external_ref) — see lib/financial-ledger-write.js).

import { amountToCents, centsToAmount, toDateOnly } from './financial-ledger.js';

// Exact-match / pattern overrides for the handful of categories whose
// txn_type or direction must differ from the transaction-kind default below.
// This mirrors the manual judgment calls made in the original one-time QBO
// backfill (see memory/notes/projects/stardust_garage/finance/
// quickbooks_supabase_sync.md) — extend this list as new one-off categories
// show up rather than special-casing them in the route.
//
// NOTE on "Owner Draw": the 3 historical Owner Draw rows were left as
// 'operating' by the manual backfill, but that reads as a data-entry
// oversight rather than intent — a draw is capital leaving the business, not
// an expense. This sync classifies NEW Owner Draw transactions as
// 'financing' (correct going forward); it does not touch the 3 existing rows.
const CATEGORY_OVERRIDES = [
  { test: /owner contribution/i, txnType: 'financing', direction: 'in' },
  { test: /owner draw/i, txnType: 'financing', direction: 'out' },
  { test: /paid under pg|personal guarant/i, txnType: 'transfer' },
];

function applyOverride(category, base) {
  const hit = CATEGORY_OVERRIDES.find((o) => o.test.test(category || ''));
  if (!hit) return base;
  return { txnType: hit.txnType || base.txnType, direction: hit.direction || base.direction };
}

function lineRow({ accountId, transactionDate, amountCents, direction, txnType, category, externalRef, createdBy, metadata }) {
  return {
    account_id: accountId,
    transaction_date: transactionDate,
    amount: centsToAmount(Math.abs(amountCents)),
    direction,
    txn_type: txnType,
    category: category || null,
    source: 'quickbooks',
    external_ref: externalRef,
    metadata,
    created_by: createdBy,
  };
}

// Purchase objects (checks, debit card charges, cash purchases): a single
// outflow, possibly split across several expense lines. Each line becomes
// its own ledger row so the category rollup on Cash Flow stays itemized
// instead of collapsing every Purchase into one bucket.
export function buildPurchaseRows({ purchases = [], accountId, createdBy = null }) {
  if (!accountId) throw new Error('buildPurchaseRows requires an accountId');
  const rows = [];
  const skipped = { noDate: 0, noLines: 0 };

  for (const p of purchases) {
    const transactionDate = toDateOnly(p.TxnDate);
    if (!transactionDate) { skipped.noDate++; continue; }

    const lines = (p.Line || []).filter((l) => l.DetailType === 'AccountBasedExpenseLineDetail' && l.Amount != null);
    if (!lines.length) { skipped.noLines++; continue; }

    lines.forEach((line, idx) => {
      const category = line.AccountBasedExpenseLineDetail?.AccountRef?.name || null;
      const base = applyOverride(category, { txnType: 'operating', direction: 'out' });
      rows.push(lineRow({
        accountId,
        transactionDate,
        amountCents: amountToCents(line.Amount),
        direction: base.direction,
        txnType: base.txnType,
        category,
        externalRef: `qbo:Purchase:${p.Id}:${line.LineNum ?? idx + 1}`,
        createdBy,
        metadata: {
          qbo_type: 'Purchase',
          qbo_id: p.Id,
          payee: p.EntityRef?.name || null,
          doc_number: p.DocNumber || null,
        },
      }));
    });
  }

  return { rows, skipped };
}

// Deposit objects: a single inflow, possibly split across several lines
// (e.g. a bank deposit that batches several income types together).
export function buildDepositRows({ deposits = [], accountId, createdBy = null }) {
  if (!accountId) throw new Error('buildDepositRows requires an accountId');
  const rows = [];
  const skipped = { noDate: 0, noLines: 0 };

  for (const d of deposits) {
    const transactionDate = toDateOnly(d.TxnDate);
    if (!transactionDate) { skipped.noDate++; continue; }

    const lines = (d.Line || []).filter((l) => l.DetailType === 'DepositLineDetail' && l.Amount != null);
    if (!lines.length) { skipped.noLines++; continue; }

    lines.forEach((line, idx) => {
      const category = line.DepositLineDetail?.AccountRef?.name || line.Description || null;
      const base = applyOverride(category, { txnType: 'operating', direction: 'in' });
      rows.push(lineRow({
        accountId,
        transactionDate,
        amountCents: amountToCents(line.Amount),
        direction: base.direction,
        txnType: base.txnType,
        category,
        externalRef: `qbo:Deposit:${d.Id}:${line.LineNum ?? idx + 1}`,
        createdBy,
        metadata: {
          qbo_type: 'Deposit',
          qbo_id: d.Id,
          doc_number: d.DocNumber || null,
        },
      }));
    });
  }

  return { rows, skipped };
}

// JournalEntry objects: manual bookkeeping entries — owner contributions,
// rent paid under a personal guarantee, corrections, etc. Each line's
// PostingType ('Debit'/'Credit') decides the raw direction (Debit = money
// out of the business by default, Credit = money in — the same convention
// Purchase/Deposit use); the category overrides above then reclassify the
// small set of categories that are financing/transfer rather than operating.
// Default (no override) is 'operating', matching how the large majority of
// historical JE lines were actually categorized in the original backfill.
export function buildJournalEntryRows({ journalEntries = [], accountId, createdBy = null }) {
  if (!accountId) throw new Error('buildJournalEntryRows requires an accountId');
  const rows = [];
  const skipped = { noDate: 0, noLines: 0 };

  for (const je of journalEntries) {
    const transactionDate = toDateOnly(je.TxnDate);
    if (!transactionDate) { skipped.noDate++; continue; }

    const lines = (je.Line || []).filter((l) => l.DetailType === 'JournalEntryLineDetail' && l.Amount != null);
    if (!lines.length) { skipped.noLines++; continue; }

    lines.forEach((line, idx) => {
      const detail = line.JournalEntryLineDetail || {};
      const category = detail.AccountRef?.name || null;
      const isDebit = detail.PostingType === 'Debit';
      const base = applyOverride(category, { txnType: 'operating', direction: isDebit ? 'out' : 'in' });
      rows.push(lineRow({
        accountId,
        transactionDate,
        amountCents: amountToCents(line.Amount),
        direction: base.direction,
        txnType: base.txnType,
        category,
        externalRef: `qbo:JournalEntry:${je.Id}:${line.LineNum ?? idx + 1}`,
        createdBy,
        metadata: {
          qbo_type: 'JournalEntry',
          qbo_id: je.Id,
          posting_type: detail.PostingType || null,
          doc_number: je.DocNumber || null,
        },
      }));
    });
  }

  return { rows, skipped };
}

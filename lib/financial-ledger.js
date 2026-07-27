// Pure helpers for the owner-only Financial Cash Flow ledger
// (public.financial_accounts / financial_transactions / spoton_import_batches).
//
// No I/O and no deps: the server component and the admin API routes fetch rows
// and hand them here, so every derivation is unit-testable and the numbers on
// the dashboard are computed the same way the sync computes them.
//
// MONEY: the ledger column is numeric(14,2) (see the migration for why), but
// ALL arithmetic in this module is done in integer cents — a decimal string is
// converted on the way in (amountToCents) and back out (centsToAmount) at the
// DB boundary only. Nothing here ever adds two floats together.

// Canonical vocabularies. The DB has matching check constraints; these are the
// app-side source of truth so a typo fails in a test rather than at insert.
export const ACCOUNT_TYPES = ['ticketing', 'pos', 'bank', 'credit_card', 'cash', 'manual'];
export const TXN_TYPES = ['operating', 'transfer', 'financing'];
export const DIRECTIONS = ['in', 'out'];
export const LEDGER_SOURCES = ['tickettailor', 'spoton_csv'];

// Seeded account names, used to resolve an account id server-side instead of
// hard-coding uuids in application code.
export const ACCOUNT_NAMES = {
  tickettailor: 'TicketTailor',
  spoton: 'SpotOn POS',
};

export const CATEGORY = {
  ticketRevenue: 'Ticket Revenue',
  posRevenue: 'POS Revenue',
  // A SpotOn day whose refunds exceed its sales is money leaving the business,
  // so it is recorded as an outflow and labelled honestly.
  posRefund: 'POS Refunds',
  // Owner equity put into the business. The QuickBooks import spelled this
  // several ways ("... - Adam Jarrett", "... (Equity) - Adam Jarrett"); those
  // rows are normalized to this exact string so the rollup reports one figure.
  ownerContribution: 'Owner Contribution',
};

// Bucket label for rows whose category is null — the column is nullable free
// text, so the category rollup always has somewhere to put them.
export const UNCATEGORIZED = 'Uncategorized';

// ---------------------------------------------------------------------------
// Money at the DB boundary
// ---------------------------------------------------------------------------

// Integer cents -> the fixed-2 decimal string the numeric column expects.
// A string (not a JS number) so the value reaches Postgres exactly as written.
export function centsToAmount(cents) {
  const n = Math.round(Number(cents) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// numeric column value (string or number) -> integer cents. Rounds rather than
// truncates so "10.005" from a future decimal source can't silently lose a cent.
export function amountToCents(amount) {
  if (amount == null) return 0;
  const n = typeof amount === 'number' ? amount : Number(String(amount).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

// YYYY-MM-DD for a Date, in the caller's local frame. Ledger dates are plain
// calendar dates (Postgres `date`), never instants.
export function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Coerce any date-ish input (Date, ISO instant, YYYY-MM-DD) to YYYY-MM-DD, or
// null when it isn't a real date. Date-only strings are taken verbatim so a
// timezone offset can never shift them onto the previous day.
export function toDateOnly(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : isoDate(value);
  const s = String(value).trim();
  const direct = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : isoDate(parsed);
}

// The current calendar month, offered as a preset rather than the default.
export function currentMonthRange(today = new Date()) {
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { start: isoDate(start), end: isoDate(end) };
}

// Default dashboard window: Jan 1 of the current year through today. A month-only
// default hid every row of an imported back-catalogue — a ledger backfilled with
// Q1 activity read as an empty dashboard when opened in July. Always inside the
// 12 months the page fetches, so this never asks for rows that were not loaded.
export function yearToDateRange(today = new Date()) {
  return { start: isoDate(new Date(today.getFullYear(), 0, 1)), end: isoDate(today) };
}

// Inclusive lower bound for the trend view / the page's initial fetch.
export function monthsAgoStart(months, today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1);
  return isoDate(d);
}

// ---------------------------------------------------------------------------
// Row normalization
// ---------------------------------------------------------------------------

// Normalize a public.financial_transactions row into the camelCase shape the UI
// and the summaries below consume. Money arrives as cents.
export function normalizeTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id || null,
    date: toDateOnly(row.transaction_date),
    amountCents: amountToCents(row.amount),
    direction: row.direction === 'out' ? 'out' : 'in',
    txnType: row.txn_type || 'operating',
    category: row.category || null,
    source: row.source || null,
    externalRef: row.external_ref || null,
    linkedEventId: row.linked_event_id || null,
    importBatchId: row.import_batch_id || null,
    notes: row.notes || null,
    metadata: row.metadata || null,
    createdAt: row.created_at || null,
  };
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

// A `transfer` is money moving between the business's own accounts. Counting it
// would double the reported cash flow, so every total below ignores it. There
// is no UI to create one yet — this is the guard for when there is.
export function countsTowardCashFlow(txn) {
  return txn?.txnType !== 'transfer';
}

// Earned/spent money: what the business trades in. This is the P&L line.
export function isOperating(txn) {
  return txn?.txnType === 'operating';
}

// Capital crossing the business boundary — owner contributions in, owner draws
// out. Real cash, but NOT revenue or expense: it says nothing about whether the
// business made money, so it is never counted in the P&L.
export function isFinancing(txn) {
  return txn?.txnType === 'financing';
}

// Operating P&L for a window: revenue in, expenses out, and the net between
// them. Financing and transfers are both excluded, so `netCents` is genuinely
// "did the business make money", not "did the bank balance go up".
export function summarizeOperating(transactions = []) {
  let revenueCents = 0;
  let expenseCents = 0;
  let counted = 0;
  for (const txn of transactions) {
    if (!isOperating(txn)) continue;
    counted++;
    if (txn.direction === 'out') expenseCents += txn.amountCents;
    else revenueCents += txn.amountCents;
  }
  return {
    revenueCents,
    expenseCents,
    netCents: revenueCents - expenseCents,
    counted,
  };
}

// Financing activity for a window, reported entirely separately from the P&L.
export function summarizeFinancing(transactions = []) {
  let contributionsCents = 0;
  let distributionsCents = 0;
  let counted = 0;
  for (const txn of transactions) {
    if (!isFinancing(txn)) continue;
    counted++;
    if (txn.direction === 'out') distributionsCents += txn.amountCents;
    else contributionsCents += txn.amountCents;
  }
  return {
    contributionsCents,
    distributionsCents,
    netCents: contributionsCents - distributionsCents,
    counted,
  };
}

// Per-account totals, one entry per account that has at least one transaction
// in the window, sorted by inflow descending. `accounts` supplies the names.
export function summarizeByAccount(transactions = [], accounts = []) {
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));
  const typeById = new Map(accounts.map((a) => [a.id, a.account_type]));
  const byAccount = new Map();
  for (const txn of transactions) {
    if (!countsTowardCashFlow(txn)) continue;
    const key = txn.accountId || 'unknown';
    if (!byAccount.has(key)) {
      byAccount.set(key, {
        accountId: txn.accountId || null,
        name: nameById.get(txn.accountId) || 'Unknown account',
        accountType: typeById.get(txn.accountId) || null,
        inflowCents: 0,
        outflowCents: 0,
        count: 0,
      });
    }
    const bucket = byAccount.get(key);
    bucket.count++;
    if (txn.direction === 'out') bucket.outflowCents += txn.amountCents;
    else bucket.inflowCents += txn.amountCents;
  }
  return [...byAccount.values()]
    .map((b) => ({ ...b, netCents: b.inflowCents - b.outflowCents }))
    .sort((a, b) => b.inflowCents - a.inflowCents || a.name.localeCompare(b.name));
}

// Per-category totals, one entry per category present in the window, sorted by
// total activity (inflow + outflow) descending so the categories the business
// actually moves money through lead the list.
//
// Each bucket carries its own rows — already resolved to an account name — so the
// drill-down renders straight from the rollup instead of re-scanning the ledger.
// It also carries a `kind` so the UI can mark at a glance which categories are
// P&L-relevant and which are financing.
export function summarizeByCategory(transactions = [], accounts = []) {
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));
  const byCategory = new Map();
  for (const txn of transactions) {
    if (!countsTowardCashFlow(txn)) continue;
    const key = txn.category || UNCATEGORIZED;
    if (!byCategory.has(key)) {
      byCategory.set(key, {
        category: key,
        inflowCents: 0,
        outflowCents: 0,
        count: 0,
        financingCount: 0,
        transactions: [],
      });
    }
    const bucket = byCategory.get(key);
    bucket.count++;
    if (isFinancing(txn)) bucket.financingCount++;
    if (txn.direction === 'out') bucket.outflowCents += txn.amountCents;
    else bucket.inflowCents += txn.amountCents;
    bucket.transactions.push({
      ...txn,
      accountName: nameById.get(txn.accountId) || 'Unknown account',
    });
  }
  return [...byCategory.values()]
    .map((b) => ({
      ...b,
      netCents: b.inflowCents - b.outflowCents,
      activityCents: b.inflowCents + b.outflowCents,
      kind: categoryKind(b),
    }))
    .sort((a, b) => b.activityCents - a.activityCents || a.category.localeCompare(b.category));
}

// Which bucket of the dashboard a category belongs to. Financing wins outright —
// a category holding any owner capital is not a P&L line, and mixing one in would
// misreport profit. Otherwise the dominant direction decides, so a revenue
// category carrying the odd refund still reads as revenue.
function categoryKind(bucket) {
  if (bucket.financingCount > 0) return 'financing';
  return bucket.outflowCents > bucket.inflowCents ? 'expense' : 'revenue';
}

// Month-by-month operating P&L with a running cumulative net, for the selected
// window. Answers "is the business profitable, and is that trending" — which the
// paired-bar cash chart cannot, because it mixes owner capital in with revenue.
//
// Buckets are clamped to the months that actually hold operating rows, so typing
// 1900 into the range picker cannot spew a thousand empty rows. Months INSIDE
// that span with no activity are still emitted: a flat month is real, and the
// running total has to carry across it.
export function monthlyOperatingPnl(transactions = [], { start = null, end = null } = {}) {
  const operating = transactions.filter((txn) => isOperating(txn) && txn.date);
  if (!operating.length) return [];

  const dates = operating.map((txn) => txn.date);
  let from = dates.reduce((a, b) => (a < b ? a : b));
  let to = dates.reduce((a, b) => (a > b ? a : b));
  if (start && start > from) from = start;
  if (end && end < to) to = end;
  if (from > to) return [];

  const buckets = [];
  const index = new Map();
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const bucket = {
      key,
      label: new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      revenueCents: 0,
      expenseCents: 0,
      netCents: 0,
      cumulativeNetCents: 0,
    };
    index.set(key, bucket);
    buckets.push(bucket);
    month++;
    if (month > 12) { month = 1; year++; }
  }

  for (const txn of operating) {
    const bucket = index.get(txn.date.slice(0, 7));
    if (!bucket) continue;
    if (txn.direction === 'out') bucket.expenseCents += txn.amountCents;
    else bucket.revenueCents += txn.amountCents;
  }

  let running = 0;
  for (const bucket of buckets) {
    bucket.netCents = bucket.revenueCents - bucket.expenseCents;
    running += bucket.netCents;
    bucket.cumulativeNetCents = running;
  }
  return buckets;
}

// Inflow/outflow per calendar month for the last `months` months ending with
// the month of `today`. Always returns exactly `months` buckets — a month with
// no activity is a real, chartable zero, not a gap.
export function monthlyTrend(transactions = [], { months = 12, today = new Date() } = {}) {
  const buckets = [];
  const index = new Map();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const bucket = {
      key,
      label: d.toLocaleDateString('en-US', { month: 'short' }),
      tooltipLabel: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      inflowCents: 0,
      outflowCents: 0,
      netCents: 0,
    };
    index.set(key, bucket);
    buckets.push(bucket);
  }
  for (const txn of transactions) {
    if (!countsTowardCashFlow(txn) || !txn.date) continue;
    const bucket = index.get(txn.date.slice(0, 7));
    if (!bucket) continue;
    if (txn.direction === 'out') bucket.outflowCents += txn.amountCents;
    else bucket.inflowCents += txn.amountCents;
    bucket.netCents = bucket.inflowCents - bucket.outflowCents;
  }
  return buckets;
}

// Window + account filter for the transaction table. `start`/`end` are
// inclusive YYYY-MM-DD bounds; either may be omitted for an open-ended side.
export function filterTransactions(transactions = [], { accountId = null, start = null, end = null } = {}) {
  return transactions.filter((txn) => {
    if (accountId && txn.accountId !== accountId) return false;
    if (!txn.date) return false;
    if (start && txn.date < start) return false;
    if (end && txn.date > end) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// TicketTailor -> ledger
// ---------------------------------------------------------------------------

// Build the ledger rows for a TicketTailor sync from the existing read-only
// metrics cache. Pure: the caller supplies the already-fetched events and
// public.event_ticket_metrics rows.
//
// Recognition date: the event's own date. event_ticket_metrics is an aggregate
// per event — it has no per-order timestamps — so this is the finest sale-date
// granularity the cache supports, and it is the same date the Financial
// Calendar attributes the income to. (Per-order sale dates do exist in
// public.ticket_order_attribution; splitting a series into per-day ledger rows
// from that table is a deliberate phase-2 refinement, not something to fake
// here.)
//
// Only status 'ok' rows with real revenue produce a transaction: an
// un-refreshed, not_configured, errored, or genuinely-zero event must not
// materialize a fabricated $0 ledger entry.
//
// `external_ref` is the local event id, which with source='tickettailor' is the
// idempotency key backing financial_transactions_source_ref_uidx — re-running
// the sync updates in place instead of duplicating.
export function buildTicketTailorLedgerRows({ events = [], metrics = [], accountId, createdBy = null }) {
  if (!accountId) throw new Error('buildTicketTailorLedgerRows requires an accountId');

  const metricsByEvent = new Map();
  for (const m of metrics) {
    if (m?.event_id) metricsByEvent.set(m.event_id, m);
  }

  const rows = [];
  const skipped = { noMetrics: 0, notOk: 0, zero: 0, noDate: 0 };

  for (const event of events) {
    const m = metricsByEvent.get(event.id);
    if (!m) { skipped.noMetrics++; continue; }
    if (m.status !== 'ok') { skipped.notOk++; continue; }

    const grossCents = Math.max(0, Math.round(Number(m.gross_cents) || 0));
    if (grossCents === 0) { skipped.zero++; continue; }

    const transactionDate = toDateOnly(event.event_date);
    if (!transactionDate) { skipped.noDate++; continue; }

    const feesCents = Math.max(0, Math.round(Number(m.fees_cents) || 0));
    const netCents = m.net_cents == null ? Math.max(0, grossCents - feesCents) : Math.round(Number(m.net_cents) || 0);

    rows.push({
      account_id: accountId,
      transaction_date: transactionDate,
      // Gross, not net: deducting processing fees from recognized revenue is
      // explicitly out of scope for this phase. The fee figure is preserved in
      // metadata so a later phase can split it out without a re-sync.
      amount: centsToAmount(grossCents),
      direction: 'in',
      txn_type: 'operating',
      category: CATEGORY.ticketRevenue,
      source: 'tickettailor',
      external_ref: event.id,
      linked_event_id: event.id,
      metadata: {
        event_title: event.title || null,
        tt_event_series_id: m.tt_event_series_id || event.tt_event_series_id || null,
        gross_cents: grossCents,
        fees_cents: feesCents,
        net_cents: netCents,
        tickets_sold: m.tickets_sold ?? null,
        orders_count: m.orders_count ?? null,
        metrics_fetched_at: m.fetched_at || null,
      },
      created_by: createdBy,
    });
  }

  return { rows, skipped };
}

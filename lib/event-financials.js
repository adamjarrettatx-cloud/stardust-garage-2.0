// Pure per-event financial calculation helpers.
//
// Everything here is a pure function over plain data shapes. No I/O, no
// secrets — fully unit-testable and safe to import anywhere server-side.
//
// Money is integer minor units (cents) throughout, matching TicketTailor and
// lib/event-analytics.js. We only convert to USD at the formatting boundary.
//
// The model, end to end:
//
//   TicketTailor (ticket sales — the ONLY ticket revenue source):
//     tt_gross         = cached gross_cents
//     tt_processor_fee = cached fees_cents (payment + booking fees)
//     tt_cpt_fee       = cptFeeCents * ticketsSold   (default $0.52/ticket)
//     tt_net           = tt_gross - tt_processor_fee - tt_cpt_fee   (>= 0)
//
//   POS (imported post-event CSV, filtered to the event time window):
//     pos_gross, pos_tax, pos_cc_fee summed from in-window rows
//     pos_net          = pos_gross - pos_tax - pos_cc_fee           (>= 0)
//
//   Contract split applies to the TT NET TICKET PROFIT only (per the user's
//   example: "50% of net profit on ticket sales"). POS net is Stardust's
//   unless a contract explicitly says otherwise — kept simple for this slice.
//
//     stardust_ticket_share    = round(tt_net * stardustPercent/100)
//     counterparty_ticket_share= tt_net - stardust_ticket_share
//     flat_fee owed to counterparty is deducted from Stardust's ticket share.
//
//   total_event_profit = tt_net + pos_net
//   stardust_total      = stardust_ticket_share - flatFee + pos_net
//   counterparty_total  = counterparty_ticket_share + flatFee

const DEFAULT_CPT_FEE_CENTS = 52; // $0.52 per TicketTailor ticket sold.

export function defaultCptFeeCents() {
  return DEFAULT_CPT_FEE_CENTS;
}

function toCents(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function toCount(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

// Clamp a value to >= 0. Intentional: a *roll-up* of net (gross - fees) should
// never display negative because of a data anomaly (e.g. fees > gross on a
// stray row, or a window that caught only refunds). Per-row net is NOT clamped
// (see posRowTaxFee/route storage) so refund losses survive at the row level
// and remain auditable; the clamp only applies to displayed aggregates.
function nonNeg(n) {
  return n < 0 ? 0 : n;
}

// Single source of truth for the per-row tax/fee decision, shared by the
// batch roll-up (summarizePosRows) and the route's per-row audit storage so
// the two can never diverge. Semantics: a tax/cc value that is PRESENT
// (`!= null`) is explicit and used as-is — including an explicit 0. Only a
// missing (null/undefined) value falls back to the config rate on gross.
// `salesTaxBps`/`ccFeeBps` are basis points (825 = 8.25%).
export function posRowTaxFee(row = {}, { salesTaxBps = 0, ccFeeBps = 0 } = {}) {
  const gross = toCents(row.gross_cents ?? row.grossCents);
  const taxRate = toCount(salesTaxBps) / 10000;
  const ccRate = toCount(ccFeeBps) / 10000;
  const rawTax = row.tax_cents ?? row.taxCents;
  const rawCc = row.cc_fee_cents ?? row.ccFeeCents;
  const tax = rawTax != null ? toCents(rawTax) : Math.round(gross * taxRate);
  const cc = rawCc != null ? toCents(rawCc) : Math.round(gross * ccRate);
  return { grossCents: gross, taxCents: tax, ccFeeCents: cc, netCents: gross - tax - cc };
}

// TicketTailor side of the calculation.
//   metrics    — a normalized cached-metrics object (lib/event-analytics
//                normalizeCachedMetrics) OR a raw row with gross_cents etc.
//   cptFeeCents — per-ticket CPT fee (default $0.52).
// Returns { ticketsSold, grossCents, processorFeesCents, cptFeeCents,
//           cptTotalCents, netCents }.
export function computeTicketTailorFinancials(metrics, { cptFeeCents = DEFAULT_CPT_FEE_CENTS } = {}) {
  const m = metrics || {};
  // Accept either the normalized shape (grossCents) or a raw row (gross_cents).
  const ticketsSold = toCount(m.ticketsSold ?? m.tickets_sold);
  const grossCents = toCents(m.grossCents ?? m.gross_cents);
  const processorFeesCents = toCents(m.feesCents ?? m.fees_cents);
  const perTicket = toCents(cptFeeCents);
  const cptTotalCents = perTicket * ticketsSold;
  const netCents = nonNeg(grossCents - processorFeesCents - cptTotalCents);
  return {
    ticketsSold,
    grossCents,
    processorFeesCents,
    cptFeeCents: perTicket,
    cptTotalCents,
    netCents,
  };
}

// Decide whether a parsed POS row falls within the event window. A row with no
// timestamp is treated as out-of-window (so undated rows never silently count).
// `windowStart`/`windowEnd` are ISO strings or null; a null bound is open.
//
// The window is half-open: [windowStart, windowEnd). The start is inclusive and
// the end is EXCLUSIVE so a transaction landing exactly on a boundary
// (`endA == startB` for back-to-back events) counts in the second window only,
// never both. All three inputs are absolute UTC instants — the route anchors
// the operator's venue-local pickers to UTC before calling this.
export function isRowInWindow(occurredAtIso, windowStart, windowEnd) {
  if (!occurredAtIso) return false;
  const t = Date.parse(occurredAtIso);
  if (Number.isNaN(t)) return false;
  if (windowStart) {
    const s = Date.parse(windowStart);
    if (!Number.isNaN(s) && t < s) return false;
  }
  if (windowEnd) {
    const e = Date.parse(windowEnd);
    if (!Number.isNaN(e) && t >= e) return false;
  }
  return true;
}

// Roll up POS rows that fall within [windowStart, windowEnd]. When a row has no
// explicit tax/cc fee, the config rates (basis points on gross) are applied as
// a fallback so the net is still meaningful.
//   rows — [{ occurred_at, gross_cents, tax_cents, cc_fee_cents, net_cents }]
// Returns { rowCount, inWindowCount, grossCents, taxCents, ccFeeCents, netCents }.
export function summarizePosRows(rows = [], { windowStart = null, windowEnd = null, salesTaxBps = 0, ccFeeBps = 0 } = {}) {
  let grossCents = 0;
  let taxCents = 0;
  let ccFeeCents = 0;
  let inWindowCount = 0;

  for (const row of rows) {
    if (!row) continue;
    const occurred = row.occurred_at ?? row.occurredAt ?? null;
    if (!isRowInWindow(occurred, windowStart, windowEnd)) continue;
    inWindowCount++;
    // Use the shared per-row decision so the roll-up here and the per-row audit
    // rows the route persists agree on what an explicit 0 means.
    const { grossCents: g, taxCents: tax, ccFeeCents: cc } = posRowTaxFee(row, { salesTaxBps, ccFeeBps });
    grossCents += g;
    taxCents += tax;
    ccFeeCents += cc;
  }

  return {
    rowCount: rows.filter(Boolean).length,
    inWindowCount,
    grossCents,
    taxCents,
    ccFeeCents,
    netCents: nonNeg(grossCents - taxCents - ccFeeCents),
  };
}

// Normalize the split inputs from a contract's financial terms into a
// canonical { stardustPercent, flatFeeCents, recipient } object. `recipient`
// is informational; the split math always expresses Stardust's percentage.
//   - When no percent is set, Stardust keeps 100% of ticket net.
//   - A percent is clamped to 0..100.
export function normalizeSplitTerms(terms = {}) {
  const t = terms || {};
  let stardustPercent = t.stardustSplitPercent ?? t.stardust_split_percent ?? null;
  if (stardustPercent != null) {
    const n = Number(stardustPercent);
    stardustPercent = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
  }
  const flatFeeCents = toCents(t.flatFeeCents ?? t.flat_fee_cents ?? 0);
  const recipient = t.revenueShareRecipient ?? t.revenue_share_recipient ?? 'stardust';
  return {
    stardustPercent: stardustPercent == null ? 100 : stardustPercent,
    hasExplicitSplit: stardustPercent != null,
    flatFeeCents,
    recipient,
  };
}

// Split TicketTailor net ticket profit per the contract terms. Flat fee is
// owed to the counterparty and comes out of Stardust's share.
// Returns { stardustShareCents, counterpartyShareCents, flatFeeCents, stardustPercent }.
export function splitTicketNet(ttNetCents, terms = {}) {
  const net = nonNeg(toCents(ttNetCents));
  const { stardustPercent, flatFeeCents } = normalizeSplitTerms(terms);
  const stardustOfNet = Math.round(net * (stardustPercent / 100));
  const counterpartyOfNet = net - stardustOfNet;
  // Flat fee is paid to the counterparty out of Stardust's split share. It can
  // drive Stardust's ticket share negative on paper; we clamp the *displayed*
  // share at 0 but keep the math honest in the totals.
  return {
    stardustPercent,
    flatFeeCents,
    stardustShareCents: stardustOfNet - flatFeeCents,
    counterpartyShareCents: counterpartyOfNet + flatFeeCents,
  };
}

// The full per-event financial summary. Combines the three inputs:
//   metrics  — normalized/raw cached TT metrics row (ticket revenue source)
//   posBatches — array of POS batch roll-up objects (already window-filtered),
//                each like { gross_cents, tax_cents, cc_fee_cents, net_cents }
//   config   — { tt_cpt_fee_cents }
//   terms    — contract financial terms (split %, flat fee, recipient)
//
// Returns a flat, render-ready object. All *_cents fields are integers.
export function buildEventFinancialSummary({ metrics = null, posBatches = [], config = {}, terms = {} } = {}) {
  const cptFeeCents = config.tt_cpt_fee_cents ?? config.cptFeeCents ?? DEFAULT_CPT_FEE_CENTS;
  const tt = computeTicketTailorFinancials(metrics, { cptFeeCents });

  // POS batches arrive pre-rolled-up (the import route stores in-window totals
  // on the batch). Sum them here so multiple imports for one event combine.
  const pos = (posBatches || []).filter(Boolean).reduce(
    (acc, b) => {
      acc.grossCents += toCents(b.gross_cents ?? b.grossCents);
      acc.taxCents += toCents(b.tax_cents ?? b.taxCents);
      acc.ccFeeCents += toCents(b.cc_fee_cents ?? b.ccFeeCents);
      acc.netCents += toCents(b.net_cents ?? b.netCents);
      acc.batches += 1;
      return acc;
    },
    { grossCents: 0, taxCents: 0, ccFeeCents: 0, netCents: 0, batches: 0 },
  );

  const split = splitTicketNet(tt.netCents, terms);

  // POS net is Stardust's in this slice (POS is the venue's own bar/merch).
  const stardustTotalCents = split.stardustShareCents + pos.netCents;
  const counterpartyTotalCents = split.counterpartyShareCents;
  const totalEventProfitCents = tt.netCents + pos.netCents;

  return {
    tickets: {
      sold: tt.ticketsSold,
      grossCents: tt.grossCents,
      processorFeesCents: tt.processorFeesCents,
      cptFeeCents: tt.cptFeeCents,
      cptTotalCents: tt.cptTotalCents,
      netCents: tt.netCents,
    },
    pos: {
      batches: pos.batches,
      grossCents: pos.grossCents,
      taxCents: pos.taxCents,
      ccFeeCents: pos.ccFeeCents,
      netCents: pos.netCents,
    },
    split: {
      stardustPercent: split.stardustPercent,
      flatFeeCents: split.flatFeeCents,
      recipient: normalizeSplitTerms(terms).recipient,
      ticketStardustShareCents: split.stardustShareCents,
      ticketCounterpartyShareCents: split.counterpartyShareCents,
    },
    totals: {
      stardustCents: stardustTotalCents,
      counterpartyCents: counterpartyTotalCents,
      totalEventProfitCents,
    },
  };
}

export function centsToUsd(cents) {
  if (cents == null) return '—';
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

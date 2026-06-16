import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultCptFeeCents,
  computeTicketTailorFinancials,
  isRowInWindow,
  summarizePosRows,
  normalizeSplitTerms,
  splitTicketNet,
  buildEventFinancialSummary,
  centsToUsd,
} from '../lib/event-financials.js';

test('defaultCptFeeCents is $0.52', () => {
  assert.equal(defaultCptFeeCents(), 52);
});

test('computeTicketTailorFinancials subtracts processor + CPT fees', () => {
  // 100 tickets, $5000 gross, $200 processor fee, $0.52 CPT.
  const r = computeTicketTailorFinancials(
    { ticketsSold: 100, grossCents: 500000, feesCents: 20000 },
    { cptFeeCents: 52 },
  );
  assert.equal(r.cptTotalCents, 5200);
  assert.equal(r.netCents, 500000 - 20000 - 5200);
});

test('computeTicketTailorFinancials accepts raw row shape (gross_cents)', () => {
  const r = computeTicketTailorFinancials({ tickets_sold: 10, gross_cents: 10000, fees_cents: 300 });
  assert.equal(r.cptTotalCents, 520);
  assert.equal(r.netCents, 10000 - 300 - 520);
});

test('computeTicketTailorFinancials clamps negative net to 0', () => {
  const r = computeTicketTailorFinancials({ ticketsSold: 100, grossCents: 100, feesCents: 0 }, { cptFeeCents: 52 });
  assert.equal(r.netCents, 0);
});

test('isRowInWindow respects bounds and rejects undated rows', () => {
  const start = '2026-06-01T18:00:00Z';
  const end = '2026-06-01T23:00:00Z';
  assert.equal(isRowInWindow('2026-06-01T20:00:00Z', start, end), true);
  assert.equal(isRowInWindow('2026-06-01T17:00:00Z', start, end), false);
  assert.equal(isRowInWindow('2026-06-02T00:00:00Z', start, end), false);
  assert.equal(isRowInWindow(null, start, end), false);
  assert.equal(isRowInWindow('not-a-date', start, end), false);
});

test('isRowInWindow treats null bounds as open', () => {
  assert.equal(isRowInWindow('2026-06-01T20:00:00Z', null, null), true);
});

test('summarizePosRows filters to window and sums explicit tax/fees', () => {
  const rows = [
    { occurred_at: '2026-06-01T20:00:00Z', gross_cents: 10000, tax_cents: 825, cc_fee_cents: 300 },
    { occurred_at: '2026-06-01T21:00:00Z', gross_cents: 5000, tax_cents: 412, cc_fee_cents: 150 },
    { occurred_at: '2026-06-02T05:00:00Z', gross_cents: 99999, tax_cents: 0, cc_fee_cents: 0 }, // out of window
  ];
  const s = summarizePosRows(rows, { windowStart: '2026-06-01T18:00:00Z', windowEnd: '2026-06-01T23:00:00Z' });
  assert.equal(s.inWindowCount, 2);
  assert.equal(s.grossCents, 15000);
  assert.equal(s.taxCents, 825 + 412);
  assert.equal(s.ccFeeCents, 450);
  assert.equal(s.netCents, 15000 - (825 + 412) - 450);
});

test('summarizePosRows falls back to config rates when row tax/fee absent', () => {
  const rows = [{ occurred_at: '2026-06-01T20:00:00Z', gross_cents: 10000 }];
  const s = summarizePosRows(rows, {
    windowStart: '2026-06-01T18:00:00Z',
    windowEnd: '2026-06-01T23:00:00Z',
    salesTaxBps: 825,
    ccFeeBps: 290,
  });
  assert.equal(s.taxCents, 825);
  assert.equal(s.ccFeeCents, 290);
  assert.equal(s.netCents, 10000 - 825 - 290);
});

test('normalizeSplitTerms defaults to 100% Stardust when no split set', () => {
  const t = normalizeSplitTerms({});
  assert.equal(t.stardustPercent, 100);
  assert.equal(t.hasExplicitSplit, false);
  assert.equal(t.flatFeeCents, 0);
});

test('normalizeSplitTerms clamps and reads snake_case', () => {
  assert.equal(normalizeSplitTerms({ stardust_split_percent: 150 }).stardustPercent, 100);
  assert.equal(normalizeSplitTerms({ stardust_split_percent: -5 }).stardustPercent, 0);
  assert.equal(normalizeSplitTerms({ stardust_split_percent: 50 }).hasExplicitSplit, true);
});

test('splitTicketNet does a 50/50 split (the worked example)', () => {
  // $1000 net ticket profit, 50% to Stardust.
  const r = splitTicketNet(100000, { stardust_split_percent: 50 });
  assert.equal(r.stardustShareCents, 50000);
  assert.equal(r.counterpartyShareCents, 50000);
});

test('splitTicketNet deducts flat fee from Stardust share', () => {
  const r = splitTicketNet(100000, { stardust_split_percent: 50, flat_fee_cents: 50000 });
  assert.equal(r.stardustShareCents, 0); // 50000 - 50000
  assert.equal(r.counterpartyShareCents, 100000); // 50000 + 50000
});

test('buildEventFinancialSummary combines TT, POS, and split', () => {
  const summary = buildEventFinancialSummary({
    metrics: { ticketsSold: 100, grossCents: 500000, feesCents: 20000 },
    posBatches: [{ gross_cents: 80000, tax_cents: 6600, cc_fee_cents: 2400, net_cents: 71000 }],
    config: { tt_cpt_fee_cents: 52 },
    terms: { stardust_split_percent: 50 },
  });
  // TT net = 500000 - 20000 - 5200 = 474800
  assert.equal(summary.tickets.netCents, 474800);
  assert.equal(summary.tickets.cptTotalCents, 5200);
  // Split 50/50 of 474800 => 237400 each.
  assert.equal(summary.split.ticketStardustShareCents, 237400);
  assert.equal(summary.split.ticketCounterpartyShareCents, 237400);
  // POS net is Stardust's.
  assert.equal(summary.pos.netCents, 71000);
  assert.equal(summary.totals.stardustCents, 237400 + 71000);
  assert.equal(summary.totals.counterpartyCents, 237400);
  assert.equal(summary.totals.totalEventProfitCents, 474800 + 71000);
});

test('buildEventFinancialSummary with no contract keeps 100% to Stardust', () => {
  const summary = buildEventFinancialSummary({
    metrics: { ticketsSold: 10, grossCents: 10000, feesCents: 0 },
    posBatches: [],
    config: {},
    terms: {},
  });
  // TT net = 10000 - 520 = 9480, all to Stardust.
  assert.equal(summary.tickets.netCents, 9480);
  assert.equal(summary.totals.stardustCents, 9480);
  assert.equal(summary.totals.counterpartyCents, 0);
});

test('buildEventFinancialSummary handles missing metrics gracefully', () => {
  const summary = buildEventFinancialSummary({ metrics: null, posBatches: [], config: {}, terms: {} });
  assert.equal(summary.tickets.netCents, 0);
  assert.equal(summary.totals.totalEventProfitCents, 0);
});

test('centsToUsd formats and handles null', () => {
  assert.equal(centsToUsd(123456), '$1,234.56');
  assert.equal(centsToUsd(null), '—');
});

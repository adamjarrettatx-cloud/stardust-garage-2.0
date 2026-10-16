import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFinancialCalendar, ticketSourceFor, ENTRY_STATE } from '../lib/financial-calendar.js';
import { buildDailyRevenue, rollupDailyRevenue } from '../lib/financial-overview.js';
import { buildSdgatxLedgerRows, LEDGER_SOURCES } from '../lib/financial-ledger.js';

const TT_EVENT = { id: 'tt1', title: 'Groove Therapy', event_date: '2026-09-19', tt_event_series_id: 'es_1', ticketing_mode: 'tickettailor' };
const SDG_EVENT = { id: 'sd1', title: 'Room on Fire', event_date: '2026-10-02', tt_event_series_id: null, ticketing_mode: 'internal' };
const EXT_EVENT = { id: 'ex1', title: 'Bass Church', event_date: '2026-09-20', tt_event_series_id: null, ticketing_mode: 'external' };
const METRICS = [
  { event_id: 'tt1', source: 'tickettailor', status: 'ok', tickets_sold: 76, gross_cents: 196030, fees_cents: 0, net_cents: 196030 },
  { event_id: 'sd1', source: 'internal', status: 'ok', tickets_sold: 109, gross_cents: 342557, fees_cents: 0, net_cents: 342557 },
  { event_id: 'ex1', source: 'placeholder', status: 'not_configured', tickets_sold: 0, gross_cents: 0 },
];

test('ticket source is Ticket Tailor for linked events, sdgatx.com for internal', () => {
  assert.equal(ticketSourceFor(TT_EVENT, { source: 'tickettailor' }), 'tickettailor');
  assert.equal(ticketSourceFor(SDG_EVENT, { source: 'internal' }), 'sdgatx');
  assert.equal(ticketSourceFor(EXT_EVENT, { source: 'placeholder' }), null);
});

test('Financials counts sdgatx.com events instead of treating them as unlinked', () => {
  const entries = buildFinancialCalendar({ events: [TT_EVENT, SDG_EVENT, EXT_EVENT], metrics: METRICS });
  const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
  assert.equal(byId.sd1.state, ENTRY_STATE.OK);
  assert.equal(byId.sd1.grossCents, 342557);
  assert.equal(byId.sd1.ticketSource, 'sdgatx');
  assert.equal(byId.tt1.ticketSource, 'tickettailor');
  assert.equal(byId.ex1.state, ENTRY_STATE.UNLINKED);
  assert.equal(byId.ex1.grossCents, 0);
});

test('daily and monthly rollups split ticket gross by source', () => {
  const entries = buildFinancialCalendar({ events: [TT_EVENT, SDG_EVENT], metrics: METRICS });
  const daily = buildDailyRevenue({ entries });
  const months = rollupDailyRevenue(daily, 'month');
  const sep = months.find((m) => m.key === '2026-09');
  const oct = months.find((m) => m.key === '2026-10');
  assert.equal(sep.ticketTailorGrossCents, 196030);
  assert.equal(sep.sdgatxGrossCents, 0);
  assert.equal(oct.sdgatxGrossCents, 342557);
  assert.equal(oct.eventGrossCents, 342557);
});

test('sdgatx ledger rows only cover internal events and use their own source', () => {
  const rows = buildSdgatxLedgerRows({ events: [TT_EVENT, SDG_EVENT, EXT_EVENT], metrics: METRICS, accountId: 'acct' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'sdgatx');
  assert.equal(rows[0].external_ref, 'sd1');
  assert.equal(rows[0].amount, '3425.57');
  assert.ok(LEDGER_SOURCES.includes('sdgatx'));
});

test('a fully refunded sdgatx event drops to $0 only when it already has a ledger row', () => {
  const refunded = [{ ...METRICS[1], gross_cents: 0, net_cents: 0 }];
  assert.equal(buildSdgatxLedgerRows({ events: [SDG_EVENT], metrics: refunded, accountId: 'a' }).length, 0);
  const rows = buildSdgatxLedgerRows({ events: [SDG_EVENT], metrics: refunded, accountId: 'a', existingRefs: new Set(['sd1']) });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, '0.00');
});

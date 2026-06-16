import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PUBLIC_VISIBILITY,
  INTERNAL_VISIBILITY,
  MICRO_PARTY_TYPE,
  isPublicEvent,
  isInternalEvent,
  isMicroParty,
} from '../lib/event-visibility.js';
import { buildEventFinancialSummary } from '../lib/event-financials.js';

// ---- Public/member visibility filtering -------------------------------------

test('isPublicEvent: explicit public events are public', () => {
  assert.equal(isPublicEvent({ visibility: PUBLIC_VISIBILITY }), true);
});

test('isPublicEvent: internal micro-party events are NOT public', () => {
  assert.equal(isPublicEvent({ visibility: INTERNAL_VISIBILITY, event_type: MICRO_PARTY_TYPE }), false);
});

test('isPublicEvent: missing visibility defaults to public (matches column default)', () => {
  // Pre-migration rows and partial selects must never be hidden by accident.
  assert.equal(isPublicEvent({ title: 'Legacy event' }), true);
  assert.equal(isPublicEvent({ visibility: undefined }), true);
  assert.equal(isPublicEvent({ visibility: null }), true);
});

test('isPublicEvent: null/undefined event is not public', () => {
  assert.equal(isPublicEvent(null), false);
  assert.equal(isPublicEvent(undefined), false);
});

test('a public events list filtered by isPublicEvent excludes internal micro parties', () => {
  const rows = [
    { id: 'a', visibility: 'public' },
    { id: 'b', visibility: 'internal', event_type: 'micro_party' },
    { id: 'c' }, // legacy row, no visibility column value
    { id: 'd', visibility: 'internal' },
  ];
  const publicIds = rows.filter(isPublicEvent).map((e) => e.id);
  assert.deepEqual(publicIds, ['a', 'c']);
});

test('every public event surface excludes internal micro parties', () => {
  // The public surfaces are /home (EventsTile), /events (list), and
  // /events/[slug] (detail). All three filter published rows down to
  // visibility = 'public'. A micro party created via EventForm defaults to
  // status='published' + visibility='internal', so the visibility filter is
  // the only thing keeping it off these pages — this test locks that rule in.
  const published = [
    { id: 'show', status: 'published', visibility: 'public' },
    { id: 'micro', status: 'published', visibility: 'internal', event_type: 'micro_party' },
    { id: 'legacy', status: 'published' }, // pre-migration row, no visibility
  ];
  const publicFacing = published.filter(isPublicEvent).map((e) => e.id);
  assert.deepEqual(publicFacing, ['show', 'legacy']);
  assert.ok(!publicFacing.includes('micro'), 'micro party must never reach a public surface');
});

test('isInternalEvent / isMicroParty classify correctly', () => {
  const mp = { visibility: 'internal', event_type: 'micro_party' };
  assert.equal(isInternalEvent(mp), true);
  assert.equal(isMicroParty(mp), true);

  const pub = { visibility: 'public', event_type: 'standard' };
  assert.equal(isInternalEvent(pub), false);
  assert.equal(isMicroParty(pub), false);
});

// ---- Financials with no TicketTailor link/metrics ---------------------------
// Internal micro parties have no TicketTailor ticket sales. The financials view
// must not error: TT figures show $0 while POS imports and contract terms still
// drive the split and totals.

test('financials summary with NO TT metrics: ticket figures are all $0', () => {
  const summary = buildEventFinancialSummary({
    metrics: null,
    posBatches: [],
    config: { tt_cpt_fee_cents: 52 },
    terms: {},
  });
  assert.equal(summary.tickets.sold, 0);
  assert.equal(summary.tickets.grossCents, 0);
  assert.equal(summary.tickets.netCents, 0);
  assert.equal(summary.totals.totalEventProfitCents, 0);
  // No contract terms ⇒ Stardust keeps 100%.
  assert.equal(summary.split.stardustPercent, 100);
});

test('financials with NO TT but with POS net flows entirely to Stardust', () => {
  const summary = buildEventFinancialSummary({
    metrics: null,
    posBatches: [{ gross_cents: 100000, tax_cents: 8250, cc_fee_cents: 2500, net_cents: 89250 }],
    config: { tt_cpt_fee_cents: 52 },
    terms: {},
  });
  assert.equal(summary.tickets.netCents, 0, 'no TT ⇒ no ticket net');
  assert.equal(summary.pos.netCents, 89250);
  assert.equal(summary.totals.stardustCents, 89250);
  assert.equal(summary.totals.counterpartyCents, 0);
  assert.equal(summary.totals.totalEventProfitCents, 89250);
});

test('financials with NO TT but a contract split: split applies to $0 ticket net, POS still Stardust', () => {
  // A micro party can have a contract (e.g. 50/50) even with no ticket sales.
  // The split applies to TT net (0 here); POS net remains Stardust's.
  const summary = buildEventFinancialSummary({
    metrics: null,
    posBatches: [{ gross_cents: 50000, tax_cents: 0, cc_fee_cents: 0, net_cents: 50000 }],
    config: { tt_cpt_fee_cents: 52 },
    terms: { stardust_split_percent: 50, flat_fee_cents: 0, revenue_share_recipient: 'artist' },
  });
  assert.equal(summary.tickets.netCents, 0);
  assert.equal(summary.split.ticketStardustShareCents, 0);
  assert.equal(summary.split.ticketCounterpartyShareCents, 0);
  assert.equal(summary.totals.stardustCents, 50000, 'POS net is Stardust regardless of ticket split');
  assert.equal(summary.totals.counterpartyCents, 0);
});

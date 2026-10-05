import test from 'node:test';
import assert from 'node:assert/strict';
import { getOnlineSalesForEvent } from '../lib/door-online-sales.js';

function fakeAdmin({ event, tickets = [], metrics = null }) {
  return {
    from(table) {
      const q = {
        select() { return q; }, eq() { return q; }, in() { return q; },
        maybeSingle: async () => ({ data: table === 'events' ? event : metrics, error: null }),
        then(resolve) { resolve({ data: tickets, error: null }); },
      };
      return q;
    },
  };
}

test('counts paid online tickets, splits scanned, separates comps, skips unpaid orders', async () => {
  const tickets = [
    { status: 'valid', order: { status: 'paid', checkout_kind: 'ticket_order' } },
    { status: 'used', order: { status: 'paid', checkout_kind: null } },
    { status: 'valid', order: { status: 'partial_refund', checkout_kind: 'ticket_order' } },
    { status: 'valid', order: { status: 'pending', checkout_kind: 'ticket_order' } },
    { status: 'used', order: { status: 'paid', checkout_kind: 'comp' } },
    { status: 'valid', order: { status: 'paid', checkout_kind: 'comp' } },
  ];
  const r = await getOnlineSalesForEvent(fakeAdmin({ event: { id: 'e', ticketing_mode: 'internal' }, tickets }), 'e');
  assert.equal(r.source, 'internal');
  assert.equal(r.sold, 3);
  assert.equal(r.sold_scanned, 1);
  assert.equal(r.comps, 2);
  assert.equal(r.comps_scanned, 1);
});

test('TicketTailor events fall back to the cached metrics snapshot', async () => {
  const r = await getOnlineSalesForEvent(fakeAdmin({
    event: { id: 'e', ticketing_mode: 'tickettailor' },
    metrics: { tickets_sold: 57, fetched_at: '2026-10-04T20:00:00Z' },
  }), 'e');
  assert.equal(r.source, 'tickettailor');
  assert.equal(r.sold, 57);
  assert.equal(r.sold_scanned, null);
});

test('unknown event returns null', async () => {
  assert.equal(await getOnlineSalesForEvent(fakeAdmin({ event: null }), 'x'), null);
});

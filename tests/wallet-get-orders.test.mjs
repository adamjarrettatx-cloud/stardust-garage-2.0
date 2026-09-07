import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWalletOrders, STARDUST_VENUE_ADDRESS } from '../lib/wallet/get-orders.js';

// getWalletOrders is the shared join used by both /api/wallet/orders AND
// the /account/tickets server page. If its output shape drifts the mobile
// app breaks silently at the same time as the web wallet. These tests pin
// the shape by feeding a minimal supabase mock and asserting on the
// enriched output the two consumers expect.

// A supabase mock that returns pre-canned rows per table + filter. We only
// need to satisfy .from(t).select(...).or(...).in(...).order(...).limit(...)
// and .from(t).select(...).in(...) — everything else in the lib is derived
// from what the mock returns.
function makeMock({ orders = [], items = [], tickets = [], events = [] } = {}) {
  const rowsByTable = { orders, order_items: items, tickets, events };

  function chain(table) {
    const state = { table, filters: [] };
    const q = {
      select() { return q; },
      or(clause) { state.filters.push(['or', clause]); return q; },
      in(col, vals) { state.filters.push(['in', col, vals]); return q; },
      eq(col, val) { state.filters.push(['eq', col, val]); return q; },
      order() { return q; },
      limit() { return q; },
      then(res) {
        let rows = rowsByTable[state.table] || [];
        for (const f of state.filters) {
          if (f[0] === 'in') rows = rows.filter((r) => f[2].includes(r[f[1]]));
          if (f[0] === 'eq') rows = rows.filter((r) => r[f[1]] === f[2]);
        }
        res({ data: rows, error: null });
      },
    };
    return q;
  }

  return { from: (t) => chain(t) };
}

test('exports the Stardust venue address as a constant', () => {
  assert.ok(STARDUST_VENUE_ADDRESS.includes('Austin'), 'address should mention Austin');
  assert.ok(STARDUST_VENUE_ADDRESS.length > 15, 'address should be a real address');
});

test('returns an empty orders array when no user is provided', async () => {
  const supabaseAdmin = makeMock();
  const res = await getWalletOrders({ supabaseAdmin, user: null });
  assert.deepEqual(res, { orders: [] });
});

test('joins events + items + tickets onto each order row', async () => {
  const supabaseAdmin = makeMock({
    orders: [
      {
        id: 'ord_1',
        event_id: 'evt_1',
        buyer_email: 'buyer@example.com',
        user_id: 'user_1',
        status: 'paid',
        subtotal_cents: 2000,
        total_cents: 2200,
        refunded_cents: 0,
        currency: 'usd',
        paid_at: '2026-09-05T00:00:00Z',
        created_at: '2026-09-05T00:00:00Z',
      },
    ],
    events: [
      { id: 'evt_1', title: 'Cosmic Cabaret', slug: 'cosmic', event_date: '2026-09-15', start_time: '20:00', image_url: 'https://x/flyer.jpg' },
    ],
    items: [
      { id: 'item_1', order_id: 'ord_1', product_name_snapshot: 'GA', tier_name_snapshot: 'Early', quantity: 2, unit_price_cents: 1000 },
    ],
    tickets: [
      { id: 't1', order_id: 'ord_1', order_item_id: 'item_1', ticket_code: 'CODE1', status: 'active' },
      { id: 't2', order_id: 'ord_1', order_item_id: 'item_1', ticket_code: 'CODE2', status: 'active' },
    ],
  });

  const { orders } = await getWalletOrders({
    supabaseAdmin,
    user: { id: 'user_1', email: 'buyer@example.com' },
  });

  assert.equal(orders.length, 1, 'should return one enriched order');
  const o = orders[0];
  assert.equal(o.id, 'ord_1');
  assert.equal(o.event?.title, 'Cosmic Cabaret');
  assert.equal(o.event?.image_url, 'https://x/flyer.jpg', 'flyer must survive the join');
  assert.equal(o.items.length, 1);
  assert.equal(o.items[0].product_name_snapshot, 'GA');
  assert.equal(o.tickets.length, 2, 'tickets are grouped by order id');
  assert.equal(o.tickets[0].ticket_code, 'CODE1');
  assert.equal(o.tickets[1].order_item_id, 'item_1', 'order_item_id must be selectable so per-ticket rows can name their product');
});

test('handles orders whose event row is missing without crashing', async () => {
  const supabaseAdmin = makeMock({
    orders: [
      { id: 'ord_2', event_id: 'evt_gone', buyer_email: 'x@y.z', user_id: 'u1', status: 'paid', created_at: '2026-09-01T00:00:00Z' },
    ],
    events: [],
    items: [],
    tickets: [],
  });
  const { orders } = await getWalletOrders({ supabaseAdmin, user: { id: 'u1', email: 'x@y.z' } });
  assert.equal(orders.length, 1);
  assert.equal(orders[0].event, null);
  assert.deepEqual(orders[0].items, []);
  assert.deepEqual(orders[0].tickets, []);
});

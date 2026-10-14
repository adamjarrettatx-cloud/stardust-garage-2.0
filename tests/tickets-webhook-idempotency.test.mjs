import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeTicketOrder } from '../lib/tickets/fulfillment.js';

// The finalizeTicketOrder function is the webhook's fulfillment path. It
// gets called TWICE for many payments in production because Stripe:
//   * fires payment_intent.succeeded AND checkout.session.completed
//   * retries deliveries during outages
//   * re-fires historical events after webhook secret rotation
//
// The contract we test here: the second invocation for the same PI must
// return { replay: true } and NOT re-issue tickets or double-consume the
// hold.

// ---- Minimal Supabase mock ------------------------------------------------
// We only need to satisfy the shape finalizeTicketOrder actually calls:
//   * .from('orders').select().eq().maybeSingle()
//   * .from('ticket_holds').select('*').eq().maybeSingle()
// The first replay path short-circuits after finding an already-paid order,
// so a very small mock is enough — anything more is out of scope for the
// idempotency contract test.
function makeMock({ orders }) {
  return {
    from(table) {
      const rows = { orders, ticket_holds: [] }[table] || [];
      const q = {
        _table: table,
        _filters: [],
        select() { return q; },
        eq(col, val) { q._filters.push([col, val]); return q; },
        async maybeSingle() {
          for (const r of rows) {
            if (q._filters.every(([c, v]) => r[c] === v)) return { data: r, error: null };
          }
          return { data: null, error: null };
        },
      };
      return q;
    },
  };
}

test('finalizeTicketOrder: replay of an already-paid PI is a no-op', async () => {
  const supabaseAdmin = makeMock({
    orders: [{ id: 'ord-1', status: 'paid', stripe_payment_intent_id: 'pi_replay' }],
  });

  const result = await finalizeTicketOrder({
    supabaseAdmin,
    holdId: 'hld_x',
    eventId: 'evt-1',
    paymentIntent: { id: 'pi_replay', amount_received: 5000 },
    session: { id: 'cs_x' },
    buyerEmail: 'buyer@example.com',
  });

  assert.equal(result.replay, true);
  assert.equal(result.orderId, 'ord-1');
  assert.deepEqual(result.ticketIds, []);
});

test('finalizeTicketOrder: missing holdId is a hard error (never silently succeed)', async () => {
  const supabaseAdmin = makeMock({ orders: [] });
  await assert.rejects(
    () => finalizeTicketOrder({
      supabaseAdmin,
      holdId: null,
      eventId: 'evt-1',
      paymentIntent: { id: 'pi_1' },
    }),
    /holdId is required/,
  );
});

test('finalizeTicketOrder: missing paymentIntent.id is a hard error', async () => {
  const supabaseAdmin = makeMock({ orders: [] });
  await assert.rejects(
    () => finalizeTicketOrder({
      supabaseAdmin,
      holdId: 'hld_a',
      eventId: 'evt-1',
      paymentIntent: {},
    }),
    /paymentIntent.id is required/,
  );
});

test('accountNameForOrder: uses the account legal name, then member profile, never throws', async () => {
  const { accountNameForOrder } = await import('../lib/tickets/fulfillment.js');
  const mk = (tables) => ({
    from(table) {
      const q = { _f: [], select() { return q; }, eq(c, v) { q._f.push([c, v]); return q; },
        async maybeSingle() {
          if (tables[table] === 'throw') throw new Error('down');
          const r = (tables[table] || []).find((row) => q._f.every(([c, v]) => row[c] === v));
          return { data: r || null, error: null };
        } };
      return q;
    },
  });
  assert.equal(await accountNameForOrder(mk({ free_accounts: [{ user_id: 'u1', full_name: ' Morgan Bartley ' }] }), 'u1'), 'Morgan Bartley');
  assert.equal(await accountNameForOrder(mk({ free_accounts: 'throw', member_profiles: [{ user_id: 'u1', full_name: 'Member Name' }] }), 'u1'), 'Member Name');
  assert.equal(await accountNameForOrder(mk({}), 'u1'), null);
  assert.equal(await accountNameForOrder(mk({}), null), null);
});

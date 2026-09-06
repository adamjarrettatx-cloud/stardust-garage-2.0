import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateTicketOrderFees, fetchChargeFee } from '../lib/tickets/hydrate-fees.js';

// The nightly hydration reads Stripe's balance_transaction.fee for each paid
// ticket order that still has fees_cents=0 and writes it back. We assert:
//   * a normal charge with a balance_transaction updates fees_cents
//   * a charge with no balance_transaction yet is skipped, not overwritten
//   * update is guarded by the fees_cents=0 predicate so it never clobbers
//     a value already hydrated by a concurrent run

function makeStripe({ charges, balanceTxns }) {
  return {
    async get(path) {
      const chargeMatch = path.match(/^\/charges\/(.+)$/);
      if (chargeMatch) {
        const c = charges[chargeMatch[1]];
        if (!c) throw new Error(`no charge ${chargeMatch[1]}`);
        return c;
      }
      const btMatch = path.match(/^\/balance_transactions\/(.+)$/);
      if (btMatch) {
        const bt = balanceTxns[btMatch[1]];
        if (!bt) throw new Error(`no balance_transaction ${btMatch[1]}`);
        return bt;
      }
      throw new Error(`unexpected path ${path}`);
    },
  };
}

// Minimal chainable Supabase query stub — enough to satisfy the specific
// call shape the hydrator uses. Tracks update calls for assertions.
function makeSupabase({ rows }) {
  const updates = [];
  const supabase = {
    from(table) {
      if (table !== 'orders') throw new Error(`unexpected table ${table}`);
      const q = {
        _filters: [],
        select() { return q; },
        eq(col, val) { q._filters.push(['eq', col, val]); return q; },
        in(col, vals) { q._filters.push(['in', col, vals]); return q; },
        not(col, op, val) { q._filters.push(['not', col, op, val]); return q; },
        gte(col, val) { q._filters.push(['gte', col, val]); return q; },
        lte(col, val) { q._filters.push(['lte', col, val]); return q; },
        order() { return q; },
        limit() { return Promise.resolve({ data: rows, error: null }); },
        update(patch) {
          const u = { patch, filters: [] };
          const chain = {
            eq(col, val) { u.filters.push(['eq', col, val]); return chain; },
            then(resolve) {
              updates.push(u);
              return Promise.resolve({ error: null }).then(resolve);
            },
          };
          return chain;
        },
      };
      return q;
    },
  };
  return { supabase, updates };
}

test('hydrates fees for a normal paid order', async () => {
  const { supabase, updates } = makeSupabase({
    rows: [
      { id: 'o1', stripe_charge_id: 'ch_1', stripe_payment_intent_id: 'pi_1', fees_cents: 0, paid_at: new Date().toISOString(), currency: 'usd' },
    ],
  });
  const stripe = makeStripe({
    charges: { ch_1: { balance_transaction: 'bt_1' } },
    balanceTxns: { bt_1: { fee: 88 } },
  });
  const result = await hydrateTicketOrderFees(supabase, { stripeClient: stripe });

  assert.equal(result.scanned, 1);
  assert.equal(result.hydrated, 1);
  assert.equal(result.errors, 0);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].patch, { fees_cents: 88 });
  // The idempotency guard must be present.
  assert.ok(updates[0].filters.some(([op, col, val]) => op === 'eq' && col === 'fees_cents' && val === 0),
    'update must include fees_cents=0 guard');
});

test('skips a charge that has no balance_transaction yet', async () => {
  const { supabase, updates } = makeSupabase({
    rows: [
      { id: 'o1', stripe_charge_id: 'ch_pending', fees_cents: 0, paid_at: new Date().toISOString(), currency: 'usd' },
    ],
  });
  const stripe = makeStripe({
    charges: { ch_pending: { balance_transaction: null } },
    balanceTxns: {},
  });
  const result = await hydrateTicketOrderFees(supabase, { stripeClient: stripe });

  assert.equal(result.hydrated, 0);
  assert.equal(result.skipped_no_bt, 1);
  assert.equal(updates.length, 0, 'no update when no balance_transaction');
});

test('fetchChargeFee returns fee_cents from balance_transaction.fee', async () => {
  const stripe = makeStripe({
    charges: { ch_x: { balance_transaction: 'bt_x' } },
    balanceTxns: { bt_x: { fee: 145, fee_details: [{ type: 'stripe_fee', amount: 145 }] } },
  });
  const out = await fetchChargeFee(stripe, 'ch_x');
  assert.equal(out.reason, 'ok');
  assert.equal(out.fee_cents, 145);
});

test('per-row Stripe error does not abort the batch', async () => {
  const { supabase, updates } = makeSupabase({
    rows: [
      { id: 'o1', stripe_charge_id: 'ch_missing', fees_cents: 0, paid_at: new Date().toISOString(), currency: 'usd' },
      { id: 'o2', stripe_charge_id: 'ch_2', fees_cents: 0, paid_at: new Date().toISOString(), currency: 'usd' },
    ],
  });
  const stripe = makeStripe({
    charges: { ch_2: { balance_transaction: 'bt_2' } }, // ch_missing not present -> throws
    balanceTxns: { bt_2: { fee: 50 } },
  });
  const result = await hydrateTicketOrderFees(supabase, { stripeClient: stripe });

  assert.equal(result.scanned, 2);
  assert.equal(result.hydrated, 1);
  assert.equal(result.errors, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].patch.fees_cents, 50);
});

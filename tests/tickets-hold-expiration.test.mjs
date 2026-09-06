import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepExpiredHolds } from '../lib/tickets/fulfillment.js';

// The cron sweeps for holds whose expires_at has passed and calls the
// release RPC on each. We assert:
//   * only expired + pending holds are picked up
//   * the release RPC is called once per matching hold
//   * release failures don't inflate the released counter

function makeMock({ pendingHolds, releaseImpl }) {
  const rpcCalls = [];
  const supabaseAdmin = {
    from() {
      const q = {
        _filters: [],
        select() { return q; },
        eq(col, val) { q._filters.push(['eq', col, val]); return q; },
        lt(col, val) { q._filters.push(['lt', col, val]); return q; },
        limit(n) { q._limit = n; return q; },
        then(res) {
          const rows = pendingHolds.filter((h) => {
            for (const [op, col, val] of q._filters) {
              if (op === 'eq' && h[col] !== val) return false;
              if (op === 'lt' && !(h[col] < val)) return false;
            }
            return true;
          }).slice(0, q._limit || pendingHolds.length);
          res({ data: rows, error: null });
        },
      };
      return q;
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return releaseImpl(args);
    },
  };
  return { supabaseAdmin, rpcCalls };
}

test('sweepExpiredHolds picks up only expired pending holds and releases each', async () => {
  const now = new Date();
  const past = new Date(now.getTime() - 60_000).toISOString();
  const future = new Date(now.getTime() + 60_000).toISOString();

  const holds = [
    { id: 'h1', status: 'pending', expires_at: past },       // released
    { id: 'h2', status: 'pending', expires_at: past },       // released
    { id: 'h3', status: 'pending', expires_at: future },     // not expired yet
    { id: 'h4', status: 'consumed', expires_at: past },      // already paid, skip
    { id: 'h5', status: 'released', expires_at: past },      // already released, skip
  ];

  const { supabaseAdmin, rpcCalls } = makeMock({
    pendingHolds: holds,
    releaseImpl: () => ({ data: true }),
  });

  const result = await sweepExpiredHolds(supabaseAdmin, { limit: 100 });

  assert.equal(result.scanned, 2);
  assert.equal(result.released, 2);
  assert.deepEqual(rpcCalls.map((c) => c.args.p_hold_id).sort(), ['h1', 'h2']);
});

test('sweepExpiredHolds does not overcount when release RPC returns false', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const holds = [
    { id: 'h1', status: 'pending', expires_at: past },
    { id: 'h2', status: 'pending', expires_at: past },
  ];
  const { supabaseAdmin } = makeMock({
    pendingHolds: holds,
    releaseImpl: ({ p_hold_id }) => ({ data: p_hold_id === 'h1' ? true : null }),
  });

  const result = await sweepExpiredHolds(supabaseAdmin, { limit: 100 });
  assert.equal(result.scanned, 2);
  assert.equal(result.released, 1);
});

test('sweepExpiredHolds honors the limit argument', async () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const holds = Array.from({ length: 25 }, (_, i) => ({ id: `h${i}`, status: 'pending', expires_at: past }));
  const { supabaseAdmin } = makeMock({
    pendingHolds: holds,
    releaseImpl: () => ({ data: true }),
  });

  const result = await sweepExpiredHolds(supabaseAdmin, { limit: 10 });
  assert.equal(result.scanned, 10);
  assert.equal(result.released, 10);
});

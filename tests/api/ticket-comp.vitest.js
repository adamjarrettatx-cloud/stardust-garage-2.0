import { describe, expect, it } from 'vitest';
import { CompError, issueComp, validateCompRequest } from '@/lib/tickets/comp';

const EVENT = '11111111-1111-4111-8111-111111111111';
const PRODUCT = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';

function body(overrides = {}) {
  return {
    event_id: EVENT, product_id: PRODUCT, quantity: 2,
    buyer_email: ' Guest@Example.com ', buyer_name: 'Guest', note: 'Artist guest',
    comp_ref: 'comp-abc', ...overrides,
  };
}

// Minimal in-memory stand-in for the Supabase query builder used by issueComp.
function fakeDb({ capacity = null, sold = 0, kind = 'tickets', productEvent = EVENT, failTickets = false } = {}) {
  const state = {
    product: { id: PRODUCT, event_id: productEvent, name: 'GA', kind },
    inventory: { product_id: PRODUCT, capacity, sold, reserved: 0 },
    holds: [], orders: [], items: [], tickets: [], audit: [],
  };
  let n = 0;
  const id = () => `id-${++n}`;
  const tables = {
    ticket_products: () => [state.product],
    ticket_inventory: () => [state.inventory],
    orders: () => state.orders,
    order_items: () => state.items,
    tickets: () => state.tickets,
    ticket_audit_log: () => state.audit,
  };
  function builder(table) {
    const filters = [];
    let op = 'select';
    let payload;
    const match = (row) => filters.every(([k, v]) => row[k] === v);
    const run = () => {
      const rows = tables[table]();
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ id: id(), created_at: 'now', ...r }));
        if (table === 'orders' && list.some((r) => r.comp_ref && rows.some((o) => o.comp_ref === r.comp_ref && o.event_id === r.event_id))) {
          return { data: null, error: { code: '23505', message: 'orders_event_comp_ref_unique' } };
        }
        if (table === 'tickets' && failTickets) return { data: null, error: { code: 'XX000', message: 'boom' } };
        rows.push(...list);
        return { data: Array.isArray(payload) ? list : list[0], error: null };
      }
      if (op === 'update') {
        const hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, payload));
        return { data: hit, error: null };
      }
      if (op === 'delete') {
        const keep = rows.filter((r) => !match(r));
        rows.splice(0, rows.length, ...keep);
        return { data: null, error: null };
      }
      return { data: rows.filter(match), error: null };
    };
    const api = {
      select() { return api; },
      insert(p) { op = 'insert'; payload = p; return api; },
      update(p) { op = 'update'; payload = p; return api; },
      delete() { op = 'delete'; return api; },
      eq(k, v) { filters.push([k, v]); return api; },
      maybeSingle() { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: r.error }); },
      single() { const r = run(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error }); },
      then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
    };
    return api;
  }
  return {
    state,
    from: (t) => builder(t),
    async rpc(name, args) {
      const inv = state.inventory;
      if (name === 'create_ticket_hold') {
        const qty = args.p_items[0].quantity;
        if (inv.capacity != null && inv.sold + inv.reserved + qty > inv.capacity) {
          return { data: null, error: { message: `INVENTORY_UNAVAILABLE:${PRODUCT}` } };
        }
        inv.reserved += qty;
        const hold = { id: id(), items: args.p_items, status: 'pending' };
        state.holds.push(hold);
        return { data: hold.id, error: null };
      }
      if (name === 'consume_ticket_hold') {
        const hold = state.holds.find((h) => h.id === args.p_hold_id);
        const qty = hold.items[0].quantity;
        inv.sold += qty; inv.reserved -= qty; hold.status = 'consumed';
        return { data: true, error: null };
      }
      if (name === 'release_ticket_hold') return { data: true, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
  };
}

describe('validateCompRequest', () => {
  it('normalizes a valid request', () => {
    const v = validateCompRequest(body());
    expect(v).toMatchObject({ email: 'guest@example.com', quantity: 2, note: 'Artist guest', sendEmail: true });
  });
  it.each([
    [{ product_id: 'nope' }, 'Choose a ticket type.'],
    [{ buyer_email: 'not-an-email' }, 'Enter a valid recipient email.'],
    [{ quantity: 0 }, 'Quantity must be between 1 and 20.'],
    [{ quantity: 21 }, 'Quantity must be between 1 and 20.'],
    [{ quantity: 1.5 }, 'Quantity must be between 1 and 20.'],
    [{ note: '  ' }, 'Enter a reason for the comp.'],
    [{ comp_ref: '' }, 'Missing submission reference. Reload and try again.'],
  ])('rejects %o', (patch, message) => {
    expect(() => validateCompRequest(body(patch))).toThrow(message);
  });
});

describe('issueComp', () => {
  it('creates a paid $0 order, tickets, inventory sale and audit row', async () => {
    const db = fakeDb({ capacity: 10, sold: 3 });
    const res = await issueComp(db, validateCompRequest(body()), ADMIN);
    expect(res.deduped).toBe(false);
    expect(res.tickets).toHaveLength(2);
    expect(db.state.orders[0]).toMatchObject({ status: 'paid', total_cents: 0, checkout_kind: 'comp', comp_ref: 'comp-abc', created_by_user_id: ADMIN });
    expect(db.state.items[0]).toMatchObject({ tier_id: null, tier_name_snapshot: 'Comp', unit_price_cents: 0, quantity: 2 });
    expect(db.state.inventory).toMatchObject({ sold: 5, reserved: 0 });
    expect(db.state.audit[0]).toMatchObject({ action: 'ticket.comp', actor_user_id: ADMIN });
  });

  it('returns the first order for a repeated comp_ref without issuing again', async () => {
    const db = fakeDb();
    const input = validateCompRequest(body());
    await issueComp(db, input, ADMIN);
    const again = await issueComp(db, input, ADMIN);
    expect(again.deduped).toBe(true);
    expect(db.state.tickets).toHaveLength(2);
    expect(db.state.inventory.sold).toBe(2);
  });

  it('refuses when capacity is exhausted and leaves no order behind', async () => {
    const db = fakeDb({ capacity: 3, sold: 2 });
    await expect(issueComp(db, validateCompRequest(body()), ADMIN)).rejects.toMatchObject({ status: 409 });
    expect(db.state.orders).toHaveLength(0);
    expect(db.state.inventory.sold).toBe(2);
  });

  it('rejects products from another event and non-admission products', async () => {
    await expect(issueComp(fakeDb({ productEvent: 'other' }), validateCompRequest(body()), ADMIN)).rejects.toBeInstanceOf(CompError);
    await expect(issueComp(fakeDb({ kind: 'private_space' }), validateCompRequest(body()), ADMIN)).rejects.toBeInstanceOf(CompError);
  });

  it('voids the order and returns inventory if ticket creation fails', async () => {
    const db = fakeDb({ capacity: 10, failTickets: true });
    await expect(issueComp(db, validateCompRequest(body()), ADMIN)).rejects.toBeTruthy();
    expect(db.state.orders[0]).toMatchObject({ status: 'void', cancel_reason: 'comp_issue_failed' });
    expect(db.state.inventory.sold).toBe(0);
    expect(db.state.audit.at(-1)).toMatchObject({ action: 'ticket.comp_failed' });
  });
});

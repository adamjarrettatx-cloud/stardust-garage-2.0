import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth-helpers', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/feature-flags', () => ({ isInternalTicketingEnabled: vi.fn() }));

import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '@/lib/auth-helpers';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { GET } from '../../app/api/admin/events/[id]/attendees/route.js';

const id = '00000000-0000-4000-8000-000000000001';
const request = (query = '') => new Request(`https://example.test/api/admin/events/${id}/attendees${query}`);
const params = { params: Promise.resolve({ id }) };
let calls;
let data;
let failure;

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ unauthorized: false });
  isInternalTicketingEnabled.mockReturnValue(true);
  failure = null;
  calls = [];
  data = {
    events: { id, title: 'Event', event_date: '2026-09-23', ticketing_mode: 'internal' },
    orders: [{ id: 'o1', buyer_name: null, buyer_email: 'buyer@example.test', member_profile_id: 'p1', user_id: 'u1', status: 'paid', total_cents: 2000 }],
    tickets: [{ id: 't1', order_id: 'o1', order_item_id: 'i1', status: 'used', used_at: '2026-09-23T01:00:00Z' }],
    attendees: [{ id: 'a1', ticket_id: 't1', full_name: 'Guest Name' }],
    order_items: [{ id: 'i1', product_name_snapshot: 'Admission' }],
    member_profiles: [{ id: 'p1', user_id: 'u1', full_name: 'Profile Name' }],
  };
  createClient.mockReturnValue({
    from(table) {
      const query = { table, filters: [] };
      calls.push(query);
      const chain = {
        select(fields) { query.fields = fields; return chain; },
        eq(key, value) { query.filters.push([key, value]); return chain; },
        in(key, value) { query.filters.push([key, value]); return chain; },
        order() { return chain; },
        range(start, end) {
          query.range = [start, end];
          return Promise.resolve({ data: data[table]?.slice(start, end + 1), error: failure === table ? new Error('Query failed') : null });
        },
        maybeSingle() { return Promise.resolve({ data: data[table], error: null }); },
      };
      return chain;
    },
  });
});

it('rejects non-admin callers before any database access', async () => {
  requireAdmin.mockResolvedValue({ unauthorized: true });
  expect((await GET(request(), params)).status).toBe(401);
  expect(createClient).not.toHaveBeenCalled();
});

it('honors the ticketing flag', async () => {
  isInternalTicketingEnabled.mockReturnValue(false);
  expect((await GET(request(), params)).status).toBe(404);
  expect(createClient).not.toHaveBeenCalled();
});

it.each(['?page=-1', '?page=1.5', '?page=abc', '?page=10001'])('rejects invalid page %s', async (query) => {
  expect((await GET(request(query), params)).status).toBe(400);
  expect(createClient).not.toHaveBeenCalled();
});

it('returns scoped names, linked profile fallback, ticket status, and private caching', async () => {
  const response = await GET(request(), params);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const body = await response.json();
  expect(body.orders[0].buyer_name).toBe('Profile Name');
  expect(body.orders[0].tickets[0].attendee_name).toBe('Guest Name');
  expect(body.orders[0].tickets[0].status).toBe('used');
  expect(body.next_page).toBe(null);
  expect(calls.find((q) => q.table === 'orders').filters).toContainEqual(['event_id', id]);
  expect(calls.find((q) => q.table === 'tickets').filters).toContainEqual(['event_id', id]);
});

it('uses the next order page without silently capping the event at 100', async () => {
  data.orders = Array.from({ length: 100 }, (_, i) => ({ id: `o${i}`, buyer_name: 'Name' }));
  expect((await (await GET(request(), params)).json()).next_page).toBe(1);
  const body = await (await GET(request('?page=1'), params)).json();
  expect(body.next_page).toBe(null);
  expect(body.orders).toEqual([]);
});

it('returns a real error rather than an empty roster when ticket reads fail', async () => {
  failure = 'tickets';
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const response = await GET(request(), params);
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/Could not load/);
  } finally { log.mockRestore(); }
});

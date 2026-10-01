import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth-helpers', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/feature-flags', () => ({ isInternalTicketingEnabled: vi.fn() }));

import { createClient } from '@supabase/supabase-js';
import { isInternalTicketingEnabled } from '@/lib/feature-flags';
import { GET } from '../../app/api/tickets/availability/route.js';

let data;
beforeEach(() => {
  vi.clearAllMocks();
  isInternalTicketingEnabled.mockReturnValue(true);
  data = {
    events: { id: 'event', title: 'Event', status: 'published', visibility: 'public', ticketing_mode: 'internal' },
    ticket_products: [{ id: 'product', name: 'Tickets', is_active: true, tier_reveal_threshold: 10 }],
    ticket_inventory: [{ product_id: 'product', capacity: null, sold: 19, reserved: 0 }],
    ticket_price_tiers: [
      { id: 'removed', product_id: 'product', name: 'EARLY BIRD', price_cents: 1500, status: 'hidden', is_active: false, display_order: 0, sold_count: 18 },
      { id: 'current', product_id: 'product', name: 'TIER 1', price_cents: 2000, status: 'active', display_order: 0, quantity: 20, sold_count: 1 },
      { id: 'next', product_id: 'product', name: 'TIER 2', price_cents: 2500, status: 'active', display_order: 1, quantity: 30, sold_count: 0 },
      { id: 'last', product_id: 'product', name: 'TIER 3', price_cents: 3000, status: 'active', display_order: 2, quantity: 40, sold_count: 0 },
    ],
  };
  createClient.mockReturnValue({
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        in() { return chain; },
        order() { return chain; },
        maybeSingle() { return Promise.resolve({ data: data[table], error: null }); },
        then(resolve, reject) { return Promise.resolve({ data: data[table], error: null }).then(resolve, reject); },
      };
      return chain;
    },
  });
});

async function getBody() {
  const response = await GET(new Request('https://example.test/api/tickets/availability?event_id=event'));
  expect(response.status).toBe(200);
  return response.json();
}

it('public API includes only current tier and no future names or prices', async () => {
  const body = await getBody();
  expect(body.products[0]).toMatchObject({
    on_sale: true,
    any_visible: true,
    price: { cents: 2000, tier_name: 'TIER 1' },
    tiers: [{ id: 'current', name: 'TIER 1', buyable: true, remaining: 19 }],
  });
  expect(body.products[0].tiers).toHaveLength(1);
  expect(JSON.stringify(body)).not.toMatch(/EARLY BIRD|TIER 2|TIER 3|2500|3000/);
});

it('low current stock does not trigger a future-tier preview', async () => {
  data.ticket_price_tiers[1].sold_count = 19;
  data.ticket_inventory[0].capacity = 20;
  const body = await getBody();
  expect(body.products[0].tiers).toHaveLength(1);
  expect(body.products[0].tiers[0]).toMatchObject({ id: 'current', remaining: 1 });
  expect(JSON.stringify(body)).not.toMatch(/TIER 2|TIER 3/);
});

it.each(['sold_out', 'removed'])('next tier replaces current after %s', async (reason) => {
  if (reason === 'sold_out') data.ticket_price_tiers[1].sold_count = 20;
  else data.ticket_price_tiers.splice(1, 1);
  const body = await getBody();
  expect(body.products[0].price).toMatchObject({ cents: 2500, tier_name: 'TIER 2' });
  expect(body.products[0].tiers).toHaveLength(1);
  expect(body.products[0].tiers[0]).toMatchObject({ id: 'next', buyable: true });
  expect(JSON.stringify(body)).not.toMatch(/EARLY BIRD|TIER 1|TIER 3/);
});

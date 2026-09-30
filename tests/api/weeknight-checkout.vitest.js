import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth-helpers', () => ({ getRequestUser: vi.fn() }));
vi.mock('@/lib/feature-flags', () => ({ isInternalTicketingEnabled: () => true }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ ok: true }), keyFromRequest: () => 'test' }));
vi.mock('@/lib/waiver-gate', () => ({ resolveWaiverGateEnabled: () => false }));
vi.mock('@/lib/account-legal-name', () => ({ accountLegalName: async () => ({ complete: true }) }));
vi.mock('@/lib/tickets/stripe', () => ({ createTicketCheckoutSession: vi.fn() }));
vi.mock('@/lib/stripe/client', () => ({ findOrCreateStripeCustomer: vi.fn() }));
vi.mock('@/lib/site-url', () => ({ resolveSiteUrl: () => 'https://www.sdgatx.com' }));
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestUser } from '@/lib/auth-helpers';
import { createTicketCheckoutSession } from '@/lib/tickets/stripe';
import { POST } from '@/app/api/tickets/hold/route';
import { GET } from '@/app/api/tickets/entitlement/route';

let event, member, products, tiers, passes, code, errors, db;
beforeEach(() => {
  vi.clearAllMocks();
  event = { id: 'event', title: 'Eligible experience', status: 'published', visibility: 'public', ticketing_mode: 'internal', is_weeknight_experience: true, booking_fee_cents_default: 100 };
  member = { id: 'member', is_active: true, subscription_status: 'active', subscription_plan: 'weekender', stripe_customer_id: 'cus_test' };
  products = [{ id: 'ticket', event_id: 'event', name: 'Ticket', kind: 'tickets', is_active: true, max_per_order: 10 }];
  tiers = [{ id: 'tier', product_id: 'ticket', is_active: true, price_cents: 1001, currency: 'usd' }];
  passes = []; code = null; errors = {};
  // Project real SELECT columns: dropping subscription_status or the event flag
  // from either route must break these tests, not hide behind oversized fixtures.
  db = {
    from(table) {
      let columns = '*', update = false;
      const result = () => {
        let data = update ? null : ({ events: event, member_profiles: member, ticket_products: products, ticket_price_tiers: tiers, trial_passes: passes, ticket_discount_codes: code, ticket_holds: { id: 'hold', hold_token: 'token' }, team_members: null })[table];
        if (data && !Array.isArray(data) && columns !== '*') data = Object.fromEntries(columns.split(',').map(key => key.trim()).map(key => [key, data[key]]));
        return { data, error: errors[table] || null };
      };
      const q = {
        select(value) { columns = value; return q; },
        update() { update = true; return q; },
        eq() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; },
        maybeSingle: async () => result(), single: async () => result(),
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return q;
    },
    rpc: vi.fn(async name => ({ data: name === 'create_ticket_hold' ? 'hold' : null, error: null })),
  };
  createClient.mockReturnValue(db); createAdminClient.mockReturnValue(db);
  getRequestUser.mockResolvedValue({ id: 'user', email: 'test@example.test' });
  createTicketCheckoutSession.mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/test' });
});
const preview = () => GET(new Request('https://www.sdgatx.com/api/tickets/entitlement?event_id=event'));
const checkout = (extra = {}) => POST(new Request('https://www.sdgatx.com/api/tickets/hold', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ event_id: 'event', selections: [{ product_id: 'ticket', quantity: 3 }], ...extra }),
}));
function assertStripeTotal(data) {
  const lines = createTicketCheckoutSession.mock.calls.at(-1)[0].lineDescriptors;
  const sum = lines.reduce((n, line) => n + line.quantity * line.unit_price_cents, 0);
  const holdArgs = db.rpc.mock.calls.find(([name]) => name === 'create_ticket_hold')[1];
  expect(sum).toBe(holdArgs.p_subtotal_cents);
  expect(sum).toBe(data.totals.total_cents);
  return lines;
}
it.each(['weekender', 'cowork', 'iykyk'])('%s preview and actual checkout apply 20%, with exact Stripe totals', async plan => {
  member.subscription_plan = plan;
  expect((await (await preview()).json()).percent).toBe(20);
  const response = await checkout(); expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.totals.entitlement_percent).toBe(20);
  expect(data.totals.discount_cents).toBe(600);
  assertStripeTotal(data);
});
it.each([[0, 20], [30, 30], [99, 60]])('Insider override %s resolves to %s in preview and checkout', async (override, expected) => {
  member.subscription_plan = 'iykyk'; event.member_discount_percent_iykyk = override;
  expect((await (await preview()).json()).percent).toBe(expected);
  expect((await (await checkout()).json()).totals.entitlement_percent).toBe(expected);
});
it.each(['canceled', 'past_due', 'pending', 'unpaid'])('inactive billing status %s does not earn paid benefit', async status => {
  member.subscription_status = status;
  expect((await (await preview()).json()).percent).toBe(0);
  expect((await (await checkout()).json()).totals.entitlement_percent).toBe(0);
});
it('free account and trial plan do not inherit paid weeknight discount', async () => {
  member = null;
  expect((await (await checkout()).json()).totals.entitlement_percent).toBe(0);
  member = { is_active: true, subscription_status: 'active', subscription_plan: 'trial', stripe_customer_id: 'cus_test' };
  expect((await (await checkout()).json()).totals.entitlement_percent).toBe(0);
});
it('server ignores forged eligibility, tier and prices; no flag means no new benefit', async () => {
  event.is_weeknight_experience = false;
  const data = await (await checkout({ is_weeknight_experience: true, entitlement_percent: 100, subscription_plan: 'iykyk', total_cents: 0 })).json();
  expect(data.totals.discount_cents).toBe(0); assertStripeTotal(data);
});
it.each(['member_profiles', 'trial_passes'])('%s lookup failure blocks preview and checkout before money/inventory', async table => {
  if (table === 'trial_passes') member = null;
  errors[table] = { message: 'database unavailable' };
  expect((await preview()).status).toBe(503);
  expect((await checkout()).status).toBe(503);
  expect(db.rpc).not.toHaveBeenCalled(); expect(createTicketCheckoutSession).not.toHaveBeenCalled();
});
it('rentals and fees remain full-price while multi-quantity ticket cents reconcile', async () => {
  products.push({ id: 'rental', name: 'Room', kind: 'private_space', is_active: true });
  tiers.push({ id: 'rt', product_id: 'rental', price_cents: 10000, currency: 'usd', is_active: true });
  const data = await (await checkout({ selections: [{ product_id: 'ticket', quantity: 3 }, { product_id: 'rental', quantity: 1 }] })).json();
  expect(data.totals.discount_cents).toBe(600);
  const lines = assertStripeTotal(data);
  expect(lines.find(line => line.kind === 'private_space').unit_price_cents).toBe(10000);
  expect(lines.find(line => line.kind === 'fee').unit_price_cents).toBe(400);
});
it.each([[10, 'entitlement', 600], [30, 'code', 900]])('promo %s%% never stacks and only winning codes redeem', async (pct, source, discount) => {
  code = { id: 'code', is_active: true, discount_type: 'percent', discount_value: pct, redemptions_count: 0 };
  const data = await (await checkout({ discount_code: 'TEST' })).json();
  expect(data.totals.discount_source).toBe(source);
  expect(data.totals.discount_cents).toBe(discount);
  expect(db.rpc.mock.calls.some(([name]) => name === 'increment_discount_code_redemption')).toBe(source === 'code');
  assertStripeTotal(data);
});
it('existing exact-total promo retains precedence rather than stacking', async () => {
  code = { id: 'code', is_active: true, discount_type: 'target_total', discount_value: 3000, redemptions_count: 0 };
  const data = await (await checkout({ discount_code: 'EXACT' })).json();
  expect(data.totals.discount_source).toBe('code');
  expect(data.totals.total_cents).toBeLessThanOrEqual(3000);
  expect(data.totals.total_cents).toBeGreaterThanOrEqual(2999);
  assertStripeTotal(data);
});
it('unauthenticated checkout cannot reserve inventory', async () => {
  getRequestUser.mockResolvedValue(null);
  expect((await checkout()).status).toBe(401);
  expect(db.rpc).not.toHaveBeenCalled();
});

import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/tickets/hydrate-fees', () => ({ hydrateTicketOrderFees: vi.fn() }));
vi.mock('@/lib/email', () => ({ sendDiscountCode: vi.fn(), sendTrialPassReminder: vi.fn() }));
vi.mock('@/lib/tickettailor', () => ({ getEventSeriesTicketTypes: vi.fn() }));
vi.mock('@/lib/discountCodeUtils', () => ({
  QUALIFYING_CATEGORIES: [],
  getEligibleMembers: vi.fn(),
  createCodeForMember: vi.fn(),
}));
vi.mock('@/lib/tickets/fulfillment', () => ({ sweepExpiredHolds: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/stub', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/site-url', () => ({ resolveSiteUrl: vi.fn() }));
vi.mock('@/lib/trial-pass', () => ({
  MAX_REMINDERS: 4,
  formatPassDate: vi.fn(),
  needsExpiryFlip: vi.fn(),
  reminderDueFor: vi.fn(),
}));

const originalCronSecret = process.env.CRON_SECRET;
delete process.env.CRON_SECRET;

const routes = await Promise.all([
  import('../../../app/api/cron/hydrate-ticket-fees/route.js'),
  import('../../../app/api/cron/send-discount-codes/route.js'),
  import('../../../app/api/cron/sweep-ticket-holds/route.js'),
  import('../../../app/api/cron/trial-pass-reminders/route.js'),
]);

function attackerRequest() {
  return new Request('https://example.test/api/cron/test', {
    headers: { authorization: 'Bearer undefined' },
  });
}

afterAll(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
});

describe('cron routes fail closed without CRON_SECRET', () => {
  it.each([
    ['hydrate-ticket-fees', routes[0].GET],
    ['send-discount-codes', routes[1].GET],
    ['sweep-ticket-holds', routes[2].GET],
    ['trial-pass-reminders', routes[3].GET],
  ])('%s rejects Bearer undefined', async (_name, handler) => {
    delete process.env.CRON_SECRET;

    const response = await handler(attackerRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });
});

import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: { id: 'owner', email: 'self@example.invalid' }, wallet: vi.fn(), auth: vi.fn(), enabled: true }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ marker: 'admin' }) }));
vi.mock('@/lib/auth-helpers', () => ({ getRequestUser: async request => { mocks.auth(request); return mocks.user; } }));
vi.mock('@/lib/feature-flags', () => ({ isInternalTicketingEnabled: () => mocks.enabled }));
vi.mock('@/lib/wallet/get-orders', () => ({ getWalletOrders: (...args) => mocks.wallet(...args) }));
import { GET } from '@/app/api/wallet/orders/route';
beforeEach(() => {
  vi.clearAllMocks(); mocks.user = { id: 'owner', email: 'self@example.invalid' }; mocks.enabled = true;
  mocks.wallet.mockResolvedValue({ orders: [] });
});
it('requires verified user before querying purchases', async () => {
  mocks.user = null;
  expect((await GET(new Request('https://example.invalid/api/wallet/orders?offset=0'))).status).toBe(401);
  expect(mocks.wallet).not.toHaveBeenCalled();
});
it('supports original mobile shape without opting into pagination', async () => {
  const response = await GET(new Request('https://example.invalid/api/wallet/orders'));
  expect(await response.json()).toEqual({ orders: [] });
});
it('paginates full history while scoping ownership to the verified caller', async () => {
  const orders = Array.from({ length: 100 }, (_, id) => ({ id }));
  mocks.wallet.mockResolvedValue({ orders });
  const request = new Request('https://example.invalid/api/wallet/orders?offset=100', { headers: { Authorization: 'Bearer synthetic' } });
  const response = await GET(request);
  expect(mocks.auth).toHaveBeenCalledWith(request);
  expect(mocks.wallet).toHaveBeenCalledWith(expect.objectContaining({ user: mocks.user, offset: 100, complete: true }));
  expect((await response.json()).next_offset).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it('invalid and excessive offsets never query the database', async () => {
  for (const offset of ['-1', '1.5', 'NaN', '100001']) {
    expect((await GET(new Request(`https://example.invalid/api/wallet/orders?offset=${offset}`))).status).toBe(400);
  }
  expect(mocks.wallet).not.toHaveBeenCalled();
});
it('database errors are not an empty successful history', async () => {
  mocks.wallet.mockRejectedValue(new Error('offline'));
  const response = await GET(new Request('https://example.invalid/api/wallet/orders?offset=0'));
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain('not been removed');
});

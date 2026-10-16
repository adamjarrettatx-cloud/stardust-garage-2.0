import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth-helpers', () => ({ requireAdminMfa: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { PATCH } from '../../app/api/admin/contacts/[id]/people/sales-access/route.js';
const id = '00000000-0000-4000-8000-000000000001';
const url = `https://www.sdgatx.com/api/admin/contacts/${id}/people/sales-access`;
let rpc;
beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMfa.mockResolvedValue({ unauthorized: false });
  rpc = vi.fn().mockResolvedValue({ data: [{ link_id: id, can_view_event_sales: true }], error: null });
  createClient.mockResolvedValue({ rpc });
});
const req = (body, origin = 'https://www.sdgatx.com') => new Request(url, { method: 'PATCH',
  headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
it('requires an admin and same origin before touching the database', async () => {
  requireAdminMfa.mockResolvedValue({ unauthorized: true });
  expect((await PATCH(req({ linkId: id, enabled: true }))).status).toBe(401);
  requireAdminMfa.mockResolvedValue({ unauthorized: false });
  expect((await PATCH(req({ linkId: id, enabled: true }, 'https://evil.example'))).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it('validates input and forwards only the link and boolean', async () => {
  expect((await PATCH(req({ linkId: 'bad', enabled: true }))).status).toBe(400);
  expect((await PATCH(req({ linkId: id, enabled: 'yes' }))).status).toBe(400);
  const response = await PATCH(req({ linkId: id, enabled: true, extra: 1 }));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(rpc).toHaveBeenCalledWith('set_organization_person_sales_access', { p_link_id: id, p_enabled: true });
});
it('maps database refusals', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Only an admin can change event sales access.' } });
  expect((await PATCH(req({ linkId: id, enabled: false }))).status).toBe(403);
  rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'internal' } });
  const r = await PATCH(req({ linkId: id, enabled: false }));
  expect(r.status).toBe(503); expect((await r.json()).error).not.toMatch(/internal/);
});

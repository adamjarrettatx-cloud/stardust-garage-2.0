import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth-helpers', () => ({ requirePartner: vi.fn(), createRequestScopedClient: vi.fn() }));
import { requirePartner, createRequestScopedClient } from '@/lib/auth-helpers';
import { GET } from '../../app/api/portal/events/[id]/sales/route.js';
const id = '00000000-0000-4000-8000-000000000001';
const request = new Request(`https://preview.example/api/portal/events/${id}/sales`);
const rpc = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  requirePartner.mockResolvedValue({ partner: { contact_type: ['organization'] } });
  createRequestScopedClient.mockResolvedValue({ rpc });
  rpc.mockResolvedValue({ data: { event: { id }, internal: {} } });
});
it('uses the authenticated client and never accepts a contact override', async () => {
  const response = await GET(request, { params: Promise.resolve({ id, contact_id: 'another-contact' }) });
  expect(response.status).toBe(200);
  expect(createRequestScopedClient).toHaveBeenCalledWith(request);
  expect(rpc).toHaveBeenCalledWith('partner_event_sales', { p_event_id: id });
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});
it.each(['promoter', 'vendor', 'artist', 'other'])('denies %s before reading sales', async (type) => {
  requirePartner.mockResolvedValue({ partner: { contact_type: [type] } });
  expect((await GET(request, { params: { id } })).status).toBe(404);
  expect(rpc).not.toHaveBeenCalled();
});
it('denies anonymous callers', async () => {
  requirePartner.mockResolvedValue({ unauthorized: true });
  expect((await GET(request, { params: { id } })).status).toBe(401);
  expect(rpc).not.toHaveBeenCalled();
});
it('rejects invalid identifiers without database access', async () => {
  expect((await GET(request, { params: { id: 'invalid' } })).status).toBe(404);
  expect(rpc).not.toHaveBeenCalled();
});
it.each([['P0002', 404], ['XX000', 503]])('sanitizes %s database errors', async (code, status) => {
  rpc.mockResolvedValue({ error: { code, message: 'private database detail' } });
  const response = await GET(request, { params: { id } });
  expect(response.status).toBe(status);
  expect(await response.text()).not.toContain('private database detail');
});

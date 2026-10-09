import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth-helpers', () => ({ requireTeam: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { requireTeam } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { GET, POST, PATCH, DELETE } from '../../app/api/admin/contacts/[id]/people/route.js';
import { GET as ORGS } from '../../app/api/admin/contacts/[id]/organizations/route.js';
const id = '00000000-0000-4000-8000-000000000001';
const context = { params: Promise.resolve({ id }) };
const url = `https://www.sdgatx.com/api/admin/contacts/${id}/people`;
let rpc;
beforeEach(() => {
  vi.clearAllMocks();
  requireTeam.mockResolvedValue({ unauthorized: false });
  rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  createClient.mockResolvedValue({ rpc });
});
const req = (method, body, origin = 'https://www.sdgatx.com') => new Request(url, { method,
  headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
it('blocks unauthorized and cross-origin requests before the database', async () => {
  requireTeam.mockResolvedValue({ unauthorized: true });
  expect((await GET(new Request(url), context)).status).toBe(401);
  expect((await POST(req('POST', {}), context)).status).toBe(401);
  expect((await ORGS(new Request(url), context)).status).toBe(401);
  requireTeam.mockResolvedValue({ unauthorized: false });
  for (const origin of ['https://evil.example', '']) {
    expect((await POST(req('POST', { mode: 'create', person: { name: 'X' } }, origin), context)).status).toBe(403);
    expect((await DELETE(req('DELETE', { linkId: id }, origin), context)).status).toBe(403);
  }
  expect(rpc).not.toHaveBeenCalled();
});
it('lists privately and searches only on explicit input', async () => {
  const response = await GET(new Request(url), context);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(rpc).toHaveBeenCalledWith('get_organization_people', { p_organization_id: id });
  expect((await GET(new Request(`${url}?q=a`), context)).status).toBe(400);
});
it('validates and forwards only allowed fields', async () => {
  expect((await POST(req('POST', { mode: 'create', person: { name: '' } }), context)).status).toBe(400);
  expect((await POST(req('POST', { mode: 'contact', id: 'bad' }), context)).status).toBe(400);
  expect((await PATCH(req('PATCH', { linkId: 'bad' }), context)).status).toBe(400);
  const response = await POST(req('POST', { mode: 'create', person: { name: ' Aeerie ', email: 'A@Example.com' }, role: ' Founder ', is_admin: true }), context);
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('add_organization_person', { p_organization_id: id, p_mode: 'create', p_person_id: null,
    p_name: 'Aeerie', p_email: 'a@example.com', p_phone: '', p_role: 'Founder' });
  await PATCH(req('PATCH', { linkId: id, role: 'Booker' }), context);
  expect(rpc).toHaveBeenLastCalledWith('update_organization_person', { p_link_id: id, p_role: 'Booker' });
  await DELETE(req('DELETE', { linkId: id }), context);
  expect(rpc).toHaveBeenLastCalledWith('remove_organization_person', { p_link_id: id });
});
it('maps conflicts and hides internal errors', async () => {
  rpc.mockResolvedValue({ error: { code: '23505', message: 'Aeerie is already linked to this organization.' } });
  expect((await POST(req('POST', { mode: 'contact', id }), context)).status).toBe(409);
  rpc.mockResolvedValue({ error: { code: '42883', message: 'secret internal schema details' } });
  const response = await GET(new Request(url), context);
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('secret internal');
});

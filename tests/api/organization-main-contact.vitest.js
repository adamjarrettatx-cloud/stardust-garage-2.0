import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth-helpers', () => ({ requireTeam: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { requireTeam } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { GET, PUT } from '../../app/api/admin/contacts/[id]/main-contact/route.js';
const id = '00000000-0000-4000-8000-000000000001';
const context = { params: Promise.resolve({ id }) };
const url = `https://www.sdgatx.com/api/admin/contacts/${id}/main-contact`;
let rpc;
beforeEach(() => {
  vi.clearAllMocks();
  requireTeam.mockResolvedValue({ unauthorized: false });
  rpc = vi.fn().mockResolvedValue({ data: { version: 0, person: null }, error: null });
  createClient.mockResolvedValue({ rpc });
});
const put = (body, origin = 'https://www.sdgatx.com') => new Request(url, { method: 'PUT',
  headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
it('blocks unauthorized reads and writes before reaching the database', async () => {
  requireTeam.mockResolvedValue({ unauthorized: true });
  expect((await GET(new Request(url), context)).status).toBe(401);
  expect((await PUT(put({}), context)).status).toBe(401);
  expect(createClient).not.toHaveBeenCalled();
});
it('blocks cross-origin and missing-origin writes', async () => {
  for (const origin of ['https://evil.example', '']) expect((await PUT(put({}, origin), context)).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});
it('returns a private uncached contact and searches only on explicit input', async () => {
  let response = await GET(new Request(url), context);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(rpc).toHaveBeenCalledTimes(1);
  rpc.mockResolvedValueOnce({ data: { version: 1, person: null } }).mockResolvedValueOnce({ data: [{ source:'account',id,name:'Person' }] });
  response = await GET(new Request(`${url}?q=Person`), context);
  expect((await response.json()).candidates[0].source).toBe('account');
  expect(rpc).toHaveBeenLastCalledWith('search_organization_people', { p_query:'Person' });
});
it('validates writes and forwards only allowed fields to the atomic RPC', async () => {
  expect((await PUT(put({ mode:'account', id:'bad', expectedVersion:0 }), context)).status).toBe(400);
  const response=await PUT(put({ mode:'account', id, expectedVersion:2, actor_id:'forged', is_admin:true }), context);
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('set_organization_main_contact', {
    p_organization_id:id,p_mode:'account',p_person_id:id,p_name:'',p_email:'',p_phone:'',p_expected_version:2,
  });
});
it('returns conflicts rather than silently overwriting another editor', async () => {
  rpc.mockResolvedValue({ error:{ code:'40001',message:'The main contact changed. Refresh and try again.' } });
  expect((await PUT(put({mode:'clear',expectedVersion:2}),context)).status).toBe(409);
});
it('does not leak database errors when a migration or backend is unavailable', async () => {
  rpc.mockResolvedValue({ error:{ code:'42883',message:'secret internal schema details' } });
  const response=await GET(new Request(url),context);
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('secret internal');
});

import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth-helpers', () => ({
  requirePartner: vi.fn(), createRequestScopedClient: vi.fn(), getRequestUser: vi.fn(),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
import { requirePartner, createRequestScopedClient, getRequestUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { PATCH } from '../../app/api/portal/profile/route.js';
import { POST } from '../../app/api/portal/complete-activation/route.js';

const user = { id: '00000000-0000-4000-8000-000000000001' };
const makeRequest = (body, method = 'PATCH') => new Request('https://example.test/api/portal/profile', {
  method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-session' },
  body: JSON.stringify(body),
});
let updates, filters, profile, staff;
beforeEach(() => {
  vi.clearAllMocks();
  updates = []; filters = [];
  profile = { id: 'partner', is_active: false, activated_at: null };
  staff = null;
  requirePartner.mockResolvedValue({ user, unauthorized: false });
  getRequestUser.mockResolvedValue(user);
  const client = {
    from(table) {
      const chain = {
        select() { return chain; },
        update(data) { updates.push({ table, data }); return chain; },
        eq(key, value) { filters.push([key, value]); return chain; },
        is(key, value) { filters.push([key, value]); return chain; },
        maybeSingle() { return Promise.resolve({ data: table === 'team_members' ? staff : profile }); },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return chain;
    },
  };
  createRequestScopedClient.mockResolvedValue(client);
  createAdminClient.mockReturnValue(client);
});
it('profile writes use the bearer-aware gate and caller scope, never client IDs/roles', async () => {
  const request = makeRequest({ fullName: '  Example  ', is_active: true, contact_id: 'other', user_id: 'other' });
  expect((await PATCH(request)).status).toBe(200);
  expect(requirePartner).toHaveBeenCalledWith(request);
  expect(createRequestScopedClient).toHaveBeenCalledWith(request);
  expect(updates).toEqual([{ table: 'partner_profiles', data: { full_name: 'Example' } }]);
  expect(filters).toContainEqual(['user_id', user.id]);
});
it('unauthorized callers cannot touch any profile', async () => {
  requirePartner.mockResolvedValue({ unauthorized: true });
  expect((await PATCH(makeRequest({ fullName: 'Example' }))).status).toBe(401);
  expect(createRequestScopedClient).not.toHaveBeenCalled();
});
it.each([
  { fullName: '' }, { fullName: 'a'.repeat(121) },
  { fullName: 'Example', photoPath: 'another-user/partner-photo.jpg' },
])('rejects invalid profile fields %j', async (body) => {
  expect((await PATCH(makeRequest(body))).status).toBe(400);
  expect(updates).toEqual([]);
});
const activation = () => makeRequest({ fullName: 'Example', photoPath: `${user.id}/partner-test.jpg` }, 'POST');
it('a disabled partner cannot reactivate themselves', async () => {
  profile.activated_at = '2026-09-01';
  expect((await POST(activation())).status).toBe(403);
  expect(updates).toEqual([]);
});
it.each(['front_desk', 'calendar_viewer'])('restricted %s cannot activate a partner capability', async (role) => {
  staff = { role };
  expect((await POST(activation())).status).toBe(403);
  expect(updates).toEqual([]);
});
it('activation is idempotent for active partners', async () => {
  profile.is_active = true;
  expect((await POST(activation())).status).toBe(200);
  expect(updates).toEqual([]);
});
it('new invitation can activate only its own still-pending profile', async () => {
  expect((await POST(activation())).status).toBe(200);
  expect(filters).toContainEqual(['user_id', user.id]);
  expect(filters).toContainEqual(['activated_at', null]);
  expect(updates[0].data.is_active).toBe(true);
});

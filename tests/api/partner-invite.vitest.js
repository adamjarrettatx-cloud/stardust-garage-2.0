import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth-helpers', () => ({ requireAdminMfa: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/contact-helpers', () => ({
  auditContact: vi.fn(), contactTypeLabel: (type) => type, isContractorContact: () => false,
}));
vi.mock('@/lib/email', () => ({ sendPartnerInvite: vi.fn() }));
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendPartnerInvite } from '@/lib/email';
import { POST } from '../../app/api/admin/invite-partner/route.js';

let existing, writes;
const request = () => new Request('https://sdgatx.com/api/admin/invite-partner', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ contactId: 'contact-1' }),
});
beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  existing = { id: 'profile-1', user_id: 'partner-1', invited_email: 'partner@example.test' };
  requireAdminMfa.mockResolvedValue({ user: { id: 'admin-1', email: 'admin@example.test' }, unauthorized: false });
  sendPartnerInvite.mockResolvedValue(undefined);
  createAdminClient.mockReturnValue({
    auth: { admin: {
      createUser: vi.fn().mockResolvedValue({ error: { message: 'User already registered' } }),
      listUsers: vi.fn().mockResolvedValue({ data: { users: [{ id: 'partner-1', email: 'partner@example.test' }] } }),
      generateLink: vi.fn().mockResolvedValue({ data: { properties: { hashed_token: 'synthetic-token' } } }),
    } },
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        update(data) { writes.push({ table, operation: 'update', data }); return chain; },
        insert(data) { writes.push({ table, operation: 'insert', data }); return chain; },
        maybeSingle() { return Promise.resolve({ data: table === 'contacts'
          ? { id: 'contact-1', display_name: 'Contact Name', email: 'partner@example.test', contact_type: ['promoter'] }
          : existing }); },
        then(resolve) { return Promise.resolve({ error: null }).then(resolve); },
      };
      return chain;
    },
  });
});
it.each([true, false])('reinvite preserves activation and personal fields when active=%s', async (is_active) => {
  Object.assign(existing, { is_active, activated_at: '2026-09-01', full_name: 'Chosen Name', photo_url: 'owned/photo.jpg' });
  expect((await POST(request())).status).toBe(200);
  expect(writes).toEqual([{
    table: 'partner_profiles', operation: 'update',
    data: { invited_by: 'admin-1', invited_at: expect.any(String) },
  }]);
  expect(sendPartnerInvite).toHaveBeenCalledOnce();
});
it('refuses to silently transfer an existing contact to another auth identity', async () => {
  existing.user_id = 'another-partner';
  expect((await POST(request())).status).toBe(409);
  expect(writes).toEqual([]);
  expect(sendPartnerInvite).not.toHaveBeenCalled();
});
it('creates a new invitation as inactive under the resolved auth identity', async () => {
  existing = null;
  expect((await POST(request())).status).toBe(200);
  expect(writes[0]).toMatchObject({
    operation: 'insert', data: { user_id: 'partner-1', contact_id: 'contact-1', is_active: false },
  });
});
it('requires administrator MFA before reading or writing identities', async () => {
  requireAdminMfa.mockResolvedValue({ unauthorized: true, reason: 'mfa_required' });
  expect((await POST(request())).status).toBe(401);
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(sendPartnerInvite).not.toHaveBeenCalled();
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAccountProfile } from '../../lib/account-profile.js';
import { VIEW_PERSONAS } from '../../lib/view-portal/personas.js';

vi.mock('@/lib/auth-helpers', () => ({ getRequestUser: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
import { getRequestUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { PATCH } from '../../app/api/account/profile/route.js';

describe('profile presentation across all preview identities', () => {
  it.each(VIEW_PERSONAS)('$id receives only its assigned workspace navigation', (persona) => {
    const model = buildAccountProfile({
      member: persona.plan ? { is_active: true, subscription_status: 'active', subscription_plan: persona.plan } : null,
      partner: persona.partner ? { contact_type: persona.partner, is_active: !persona.partnerState, activated_at: persona.partnerState === 'disabled' ? '2026-01-01' : null } : null,
      passes: persona.trial ? [{ status: persona.trial === 'expired' ? 'expired' : 'active', signup_expires_at: '2099-01-01' }] : [],
      teamRole: persona.teamRole,
    });
    const paths = model.workspaces.map((item) => item.href);
    expect(paths.includes('/bananas')).toBe(persona.teamRole === 'admin');
    expect(paths.includes('/member')).toBe(Boolean(persona.plan));
    expect(paths.includes('/portal/activate')).toBe(persona.partnerState === 'invited');
    expect(model.partnerActive).toBe(Boolean(persona.partner && !persona.partnerState));
    if (persona.id === 'free' || persona.id === 'disabled-partner') expect(paths).toEqual([]);
    if (persona.teamRole === 'front_desk') expect(paths).toEqual(['/capacity/front-desk']);
    if (persona.teamRole === 'calendar_viewer') expect(paths).toEqual(['/team/calendar']);
    expect(paths).not.toContain('/bananas/view-portal');
    expect(model.access[0].value).not.toContain('undefined');
  });
  it.each(['front_desk', 'calendar_viewer'])('does not turn %s plus a partner record into broader access', (teamRole) => {
    const model = buildAccountProfile({
      teamRole, member: { is_active: true, subscription_status: 'active' },
      partner: { is_active: true, contact_type: ['dj'] },
      resources: { grants: [{}], bookings: [{}], contracts: [{}] },
    });
    expect(model.partnerActive).toBe(false);
    expect(model.workspaces).toHaveLength(1);
  });
  it('does not let assigned resources override profile-type restrictions', () => {
    const model = buildAccountProfile({ partner: { is_active: true, contact_type: ['other'] }, resources: { contracts: [{}] } });
    expect(model.workspaces).toEqual([]);
  });
  it('does not label a past-due membership as active', () => {
    const model = buildAccountProfile({ member: { is_active: true, subscription_status: 'past_due', subscription_plan: 'cowork' } });
    expect(model.access[0].value).toBe('Membership inactive');
  });
});

describe('own contact-details mutation', () => {
  let previous, writes, filters, failure;
  const user = { id: 'own-user', email: 'own@example.invalid' };
  const request = (body, origin = 'https://preview.example', authorization = null) => new Request('https://preview.example/api/account/profile', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}), ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body),
  });
  beforeEach(() => {
    vi.clearAllMocks(); writes = []; filters = []; failure = false;
    previous = { phone: '+12025550100', phone_verified_at: '2026-01-01' };
    getRequestUser.mockResolvedValue(user);
    createAdminClient.mockReturnValue({ from(table) {
      expect(table).toBe('free_accounts');
      return {
        select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
        async maybeSingle() { return { data: previous, error: failure ? { message: 'private database detail' } : null }; },
        async upsert(value) { expect(typeof value.phone).toBe('string'); writes.push(value); return { error: null }; },
      };
    } });
  });
  it('preserves verification for an unchanged phone and scopes writes to authenticated identity', async () => {
    expect((await PATCH(request({ fullName: '  Test   Name ', phone: '+1 (202) 555-0100' }))).status).toBe(200);
    expect(filters).toEqual([['user_id', user.id]]);
    expect(writes[0]).toMatchObject({ user_id: user.id, email: user.email, full_name: 'Test Name', phone_verified_at: '2026-01-01' });
  });
  it.each(['+12025550199', ''])('clears verification when the phone changes to %s', async (phone) => {
    expect((await PATCH(request({ fullName: 'Test', phone }))).status).toBe(200);
    expect(writes[0].phone_verified_at).toBeNull();
  });
  it.each(['user_id', 'is_active', 'role', 'phone_verified_at', 'email'])('rejects privileged or unsupported %s input', async (key) => {
    expect((await PATCH(request({ fullName: 'Test', phone: '', [key]: 'attacker-value' }))).status).toBe(400);
    expect(writes).toEqual([]);
  });
  it.each([{ fullName: '', phone: '' }, { fullName: 'x'.repeat(121), phone: '' }, { fullName: 'Test', phone: 'not a phone' }, { fullName: 'Test', phone: '123' }, { fullName: 'Test', phone: 123 }])('rejects invalid contact values', async (body) => {
    expect((await PATCH(request(body))).status).toBe(400); expect(writes).toEqual([]);
  });
  it.each(['https://attacker.invalid', null])('rejects cookie writes from invalid origins', async (origin) => {
    expect((await PATCH(request({ fullName: 'Test', phone: '' }, origin))).status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it('rejects signed-out callers', async () => {
    getRequestUser.mockResolvedValue(null);
    expect((await PATCH(request({ fullName: 'Test', phone: '' }))).status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
  it('accepts authenticated mobile bearer calls without ambient origin', async () => {
    expect((await PATCH(request({ fullName: 'Test', phone: '' }, null, 'Bearer verified-by-auth-helper')))).toHaveProperty('status', 200);
  });
  it('does not overwrite data after a failed read or leak database details', async () => {
    failure = true;
    const response = await PATCH(request({ fullName: 'Test', phone: '' }));
    expect(response.status).toBe(500); expect(writes).toEqual([]);
    expect(await response.text()).not.toContain('private database detail');
  });
});

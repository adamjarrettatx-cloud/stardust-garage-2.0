import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accessStatus, restrictionGuard } from '@/lib/capacity/access-restrictions';
import { POST } from '@/app/api/capacity/access-restrictions/route';

const auth = vi.hoisted(() => ({ gate: { unauthorized: false, user: { id: 'owner' }, isAdmin: false }, client: null }));
vi.mock('@/lib/auth-helpers', () => ({ requireFrontDeskOrTeam: async () => auth.gate }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => auth.client }));
const subject = { kind: 'member', id: '00000000-0000-4000-8000-000000000001' };
const restriction = { id: '00000000-0000-4000-8000-000000000010', full_name: 'Test Guest', kind: 'banned',
  reason: 'Test reason', identity_keys: [], match_keys: ['name:test guest'], lifted_at: null, expires_at: null };
function database({ rows = [], exclusions = [], fail = null } = {}) {
  return {
    rpc: vi.fn(async () => ({ data: restriction.id })),
    from(table) {
      let overlap = null;
      const builder = {
        select: () => builder, eq: () => builder, is: () => builder, in: () => builder,
        order: () => builder, limit: () => builder,
        overlaps: (field, values) => { overlap = { field, values }; return builder; },
        single: async () => table === fail ? { error: { message: 'offline' } } : { data: { id: subject.id, full_name: 'Test Guest', email: 'test@example.invalid', user_id: null } },
        maybeSingle: async () => ({ data: null }),
        then(resolve, reject) {
          let data = [];
          if (table === 'access_restrictions') data = rows.filter(row => !overlap || row[overlap.field].some(key => overlap.values.includes(key)));
          if (table === 'access_restriction_exclusions') data = exclusions.map(id => ({ restriction_id: id }));
          return Promise.resolve(table === fail ? { error: { message: 'offline' } } : { data }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}
beforeEach(() => { auth.gate = { unauthorized: false, user: { id: 'owner' }, isAdmin: false }; auth.client = database(); });
describe('live access checks', () => {
  it('does not classify a name-only match as a confirmed ban', async () => {
    const result = await accessStatus(database({ rows: [restriction] }), subject);
    expect(result.status).toBe('verify');
    expect(result.matches[0].match).toBe('possible');
  });
  it('honors audited different-person exclusion only for possible matches', async () => {
    expect((await accessStatus(database({ rows: [restriction], exclusions: [restriction.id] }), subject)).status).toBe('clear');
    const linked = { ...restriction, identity_keys: [`member:${subject.id}`] };
    expect((await accessStatus(database({ rows: [linked], exclusions: [restriction.id] }), subject)).status).toBe('blocked');
  });
  it('ignores expired/lifted restrictions', async () => {
    expect((await accessStatus(database({ rows: [{ ...restriction, expires_at: '2000-01-01T00:00:00Z' }] }), subject)).status).toBe('clear');
    expect((await accessStatus(database({ rows: [{ ...restriction, lifted_at: '2026-01-01' }] }), subject)).status).toBe('clear');
  });
  it('fails closed on identity, restriction, exclusion or notes read failures', async () => {
    for (const fail of ['member_profiles', 'access_restrictions', 'access_restriction_exclusions', 'access_restriction_events']) {
      const response = await restrictionGuard(database({ rows: [restriction], fail }), subject);
      expect(response.status).toBe(503);
      expect((await response.json()).code).toBe('access_unavailable');
    }
  });
  it('rechecks a new restriction at admission instead of trusting a previous clear preview', async () => {
    const rows = [];
    const db = database({ rows });
    expect(await restrictionGuard(db, subject)).toBeNull();
    rows.push({ ...restriction, identity_keys: [`member:${subject.id}`] });
    expect((await restrictionGuard(db, subject)).status).toBe(403);
  });
});
describe('mutation API', () => {
  const request = body => new Request('https://example.invalid/api/capacity/access-restrictions', { method: 'POST', body: JSON.stringify(body) });
  it('rejects unauthenticated callers before touching storage', async () => {
    auth.gate = { unauthorized: true };
    expect((await POST(request({ action: 'create' }))).status).toBe(401);
    expect(auth.client.rpc).not.toHaveBeenCalled();
  });
  it('allows manual names but strips forged identity keys from input', async () => {
    const response = await POST(request({ action: 'create', ...restriction, identity_keys: ['user:forged'] }));
    expect(response.status).toBe(200);
    const payload = auth.client.rpc.mock.calls[0][1].p_data;
    expect(payload.identity_keys).toEqual([]);
    expect(payload.match_keys).toContain('name:test guest');
  });
  it('refuses staff permission grants', async () => {
    expect((await POST(request({ action: 'manager', user_id: subject.id, enabled: true }))).status).toBe(403);
    expect(auth.client.rpc).not.toHaveBeenCalled();
  });
  it('passes manager-only lift denial through without reporting success', async () => {
    auth.client.rpc.mockResolvedValue({ error: { code: '42501' } });
    expect((await POST(request({ action: 'lift', id: restriction.id, comment: 'Reason' }))).status).toBe(403);
  });
  it('does not allow dismissing an unrelated restriction', async () => {
    expect((await POST(request({ action: 'different_person', id: restriction.id, subject, comment: 'Reason' }))).status).toBe(400);
    expect(auth.client.rpc).not.toHaveBeenCalled();
  });
});

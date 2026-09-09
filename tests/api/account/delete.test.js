import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [],
  sentEmail: [],
  getRequestUser: vi.fn(),
}));

function responseFor(call) {
  if (call.table === 'member_profiles' && call.action === 'select') {
    return { data: [{ id: 'member-profile-1', profile_photo_path: 'members/avatar.jpg' }], error: null };
  }
  if (call.table === 'free_accounts' && call.action === 'select') {
    return { data: [{ profile_photo_path: 'free/avatar.jpg' }], error: null };
  }
  if (call.table === 'trial_passes' && call.action === 'select') {
    return { data: [{ profile_photo_path: 'trials/avatar.jpg' }], error: null };
  }
  if (call.table === 'account_deletions' && call.action === 'insert') {
    return { data: { completed_at: '2026-09-11T12:00:00.000Z' }, error: null };
  }
  return { data: null, error: null };
}

function builder(table) {
  const call = { table, action: null, filters: [], values: null, single: false };
  state.calls.push(call);
  const query = {
    select: () => { if (!call.action) call.action = 'select'; return query; },
    update: (values) => { call.action = 'update'; call.values = values; return query; },
    delete: () => { call.action = 'delete'; return query; },
    insert: (values) => { call.action = 'insert'; call.values = values; return query; },
    eq: (column, value) => { call.filters.push(['eq', column, value]); return query; },
    in: (column, value) => { call.filters.push(['in', column, value]); return query; },
    is: (column, value) => { call.filters.push(['is', column, value]); return query; },
    or: (value) => { call.filters.push(['or', value]); return query; },
    maybeSingle: () => { call.single = true; return query; },
    single: () => { call.single = true; return query; },
    then: (resolve, reject) => Promise.resolve(responseFor(call)).then(resolve, reject),
  };
  return query;
}

const admin = {
  from: (table) => builder(table),
  storage: { from: () => ({ remove: (paths) => { state.calls.push({ table: 'profile-photos', action: 'remove', paths }); return Promise.resolve({ error: null }); } }) },
  auth: { admin: {
    signOut: (id) => { state.calls.push({ table: 'auth.users', action: 'signOut', id }); return Promise.resolve({ error: null }); },
    deleteUser: (id) => { state.calls.push({ table: 'auth.users', action: 'deleteUser', id }); return Promise.resolve({ error: null }); },
  } },
};

vi.mock('@/lib/auth-helpers', () => ({ getRequestUser: state.getRequestUser }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }));
vi.mock('@/lib/email', () => ({
  sendAccountDeletionConfirmation: async ({ email }) => { state.sentEmail.push(email); },
}));

const { POST } = await import('../../../app/api/account/delete/route.js');

function request(userId, body, authorization = true) {
  return new Request('https://example.test/api/account/delete', {
    method: 'POST',
    headers: authorization ? { authorization: `Bearer ${userId}`, 'content-type': 'application/json' } : { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.calls.length = 0;
  state.sentEmail.length = 0;
  state.getRequestUser.mockImplementation(async (requestValue) => {
    const authorization = requestValue.headers.get('authorization');
    if (!authorization) return null;
    const userId = authorization.replace('Bearer ', '');
    return { id: userId, email: `${userId}@example.test` };
  });
});

describe('POST /api/account/delete', () => {
  it('returns 401 without an Authorization header', async () => {
    const response = await POST(request('no-auth', { confirmation: 'DELETE MY ACCOUNT' }, false));
    expect(response.status).toBe(401);
  });

  it('rejects a confirmation phrase that is not exact', async () => {
    const response = await POST(request('wrong-confirmation', { confirmation: 'delete my account' }));
    expect(response.status).toBe(400);
  });

  it('returns 429 on the fourth attempt for the same account within an hour', async () => {
    const userId = 'rate-limit-user';
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await POST(request(userId, { confirmation: 'not it' }));
      expect(response.status).toBe(400);
    }
    const response = await POST(request(userId, { confirmation: 'not it' }));
    expect(response.status).toBe(429);
  });

  it('permanently deletes account data, records the audit, and sends confirmation email', async () => {
    const userId = 'successful-delete-user';
    const response = await POST(request(userId, { confirmation: 'DELETE MY ACCOUNT', reason: 'No longer using it' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deletedAt: '2026-09-11T12:00:00.000Z' });
    expect(state.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'auth.users', action: 'signOut', id: userId }),
      expect.objectContaining({ table: 'member_identity_tokens', action: 'update', values: expect.objectContaining({ revoke_reason: 'account_deleted' }) }),
      expect.objectContaining({ table: 'orders', action: 'update', values: { buyer_email: `deleted-user-${userId}@removed`, buyer_name: 'Deleted User', user_id: null } }),
      expect.objectContaining({ table: 'member_profiles', action: 'delete' }),
      expect.objectContaining({ table: 'account_deletions', action: 'insert', values: expect.objectContaining({ deleted_user_id: userId, deleted_email: `${userId}@example.test`, reason: 'No longer using it' }) }),
      expect.objectContaining({ table: 'auth.users', action: 'deleteUser', id: userId }),
    ]));
    expect(state.sentEmail).toEqual([`${userId}@example.test`]);

    const signOutIndex = state.calls.findIndex((call) => call.table === 'auth.users' && call.action === 'signOut');
    const deleteUserIndex = state.calls.findIndex((call) => call.table === 'auth.users' && call.action === 'deleteUser');
    expect(signOutIndex).toBeGreaterThanOrEqual(0);
    expect(deleteUserIndex).toBeGreaterThan(signOutIndex);
  });
});

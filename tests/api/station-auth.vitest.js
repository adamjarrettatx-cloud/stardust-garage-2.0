import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as login } from '@/app/api/station/login/route';
import { POST as logout } from '@/app/api/station/logout/route';
import { GET as list, POST as manage } from '@/app/api/admin/stations/route';
import { STATION_COOKIE } from '@/lib/station-policy';
const state = vi.hoisted(() => ({ db: null, auth: null, gate: null, mfa: true, token: null }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.db }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => state.auth }));
vi.mock('@/lib/auth-helpers', () => ({
  requireOwner: async () => state.gate, getMfaStatus: async () => ({ mfaSatisfied: state.mfa }),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => state.token ? { value: state.token } : undefined }) }));
const uid = '00000000-0000-4000-8000-000000000010';
const station = { id: uid, user_id: uid, role: 'security', username: 'security', active: true, epoch: 1, auth_email: 'internal@example.invalid' };
const req = (path, body, headers = {}) => new NextRequest(`https://www.sdgatx.com${path}`, {
  method: 'POST', headers: { origin: 'https://www.sdgatx.com', 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});
beforeEach(() => {
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(async () => ({ data: [] })),
    maybeSingle: vi.fn(async () => ({ data: station })), single: vi.fn(async () => ({ data: station })) };
  state.db = { from: vi.fn(() => query), rpc: vi.fn(async name => ({ data: name === 'create_station_account' ? { id: uid, username: 'security' } : name === 'manage_station_access' ? { epoch: 2 } : true })),
    auth: { admin: { signOut: vi.fn(async () => ({})), createUser: vi.fn(async () => ({ data: { user: { id: uid } } })),
      deleteUser: vi.fn(async () => ({})), updateUserById: vi.fn(async () => ({})) } } };
  state.auth = { auth: { signInWithPassword: vi.fn(async () => ({
    data: { user: { id: uid }, session: { access_token: 'PRIVATE_AUTH_ACCESS', refresh_token: 'PRIVATE_AUTH_REFRESH' } },
  })) } };
  state.gate = { unauthorized: false, user: { id: 'owner' } }; state.mfa = true; state.token = null;
});
describe('station authentication boundary', () => {
  it('sets only an opaque secure HTTP-only host cookie, clears underlying personal sessions, never returns provider tokens', async () => {
    const res = await login(req('/api/station/login', { username: ' Security ', password: 'secret' }, { cookie: 'sb-test-auth-token=old-personal-session' }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('PRIVATE_'); expect(text).not.toContain('internal@');
    expect(JSON.parse(text)).toEqual({ destination: '/capacity/security' });
    const cookie = res.cookies.get(STATION_COOKIE);
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie.httpOnly).toBe(true); expect(cookie.secure).toBe(true); expect(cookie.sameSite).toBe('strict');
    expect(cookie.maxAge).toBe(43200);
    expect(res.cookies.get('sb-test-auth-token').maxAge).toBe(0);
    const open = state.db.rpc.mock.calls.find(([name]) => name === 'open_station_session');
    expect(open[1].p_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(open[1].p_hash).not.toBe(cookie.value);
    expect(state.db.auth.admin.signOut).toHaveBeenCalledWith('PRIVATE_AUTH_ACCESS', 'global');
  });
  it('fails closed on limiter outage, throttling, provider revocation failure, and disabled account', async () => {
    state.db.rpc.mockResolvedValueOnce({ error: {} });
    expect((await login(req('/api/station/login', { username: 'security', password: 'secret' }))).status).toBe(503);
    expect(state.auth.auth.signInWithPassword).not.toHaveBeenCalled();
    state.db.rpc.mockResolvedValueOnce({ data: false });
    expect((await login(req('/api/station/login', { username: 'security', password: 'secret' }))).status).toBe(429);
    state.db.auth.admin.signOut.mockResolvedValueOnce({ error: {} });
    expect((await login(req('/api/station/login', { username: 'security', password: 'secret' }))).status).toBe(503);
    state.db.from().maybeSingle.mockResolvedValueOnce({ data: { ...station, active: false } });
    const res = await login(req('/api/station/login', { username: 'security', password: 'secret' }));
    expect(res.status).toBe(401); expect(await res.json()).toEqual({ error: 'Invalid username or password.' });
  });
  it('unknown usernames and invalid passwords return the same error and no cookie', async () => {
    state.db.from().maybeSingle.mockResolvedValueOnce({ data: null });
    const missing = await login(req('/api/station/login', { username: 'missing', password: 'secret' }));
    state.auth.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: 'Provider detail' } });
    const wrong = await login(req('/api/station/login', { username: 'security', password: 'wrong' }));
    expect(await missing.json()).toEqual(await wrong.json());
    expect(missing.cookies.get(STATION_COOKIE)).toBeUndefined();
    expect(wrong.cookies.get(STATION_COOKIE)).toBeUndefined();
  });
  it('epoch race at session creation cannot issue a cookie', async () => {
    state.db.rpc.mockImplementation(async name => ({ data: name !== 'open_station_session' }));
    const res = await login(req('/api/station/login', { username: 'security', password: 'secret' }));
    expect(res.status).toBe(503); expect(res.cookies.get(STATION_COOKIE)).toBeUndefined();
  });
  it('login and logout reject cross-origin requests before touching storage', async () => {
    for (const handler of [login, logout]) {
      expect((await handler(req('/api/station/login', {}, { origin: 'https://attacker.example' }))).status).toBe(403);
    }
    expect(state.db.rpc).not.toHaveBeenCalled();
  });
  it('logout revokes server-side before expiring the cookie and reports revocation failures', async () => {
    state.token = 'a'.repeat(43);
    expect((await logout(req('/api/station/logout', {}))).cookies.get(STATION_COOKIE).maxAge).toBe(0);
    expect(state.db.rpc.mock.calls[0][0]).toBe('close_station_session');
    state.db.rpc.mockResolvedValueOnce({ error: {} });
    expect((await logout(req('/api/station/logout', {}))).status).toBe(503);
  });
});
describe('owner station controls', () => {
  it('requires owner AND MFA even when the existing admin MFA flag is off', async () => {
    process.env.ENFORCE_ADMIN_MFA = 'false';
    state.gate = { unauthorized: true };
    expect((await list()).status).toBe(401);
    state.gate = { unauthorized: false, user: { id: 'owner' } }; state.mfa = false;
    expect((await manage(req('/api/admin/stations', { action: 'create' }))).status).toBe(401);
    expect(state.db.from).not.toHaveBeenCalled(); expect(state.db.rpc).not.toHaveBeenCalled();
  });
  it('rejects escalation roles and generates strong credentials rather than accepting user-supplied ones', async () => {
    const body = { action: 'create', username: 'security', label: 'Security', role: 'admin' };
    expect((await manage(req('/api/admin/stations', body))).status).toBe(400);
    const res = await manage(req('/api/admin/stations', { ...body, role: 'security', password: 'weak' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.password).toMatch(/^[A-Za-z0-9_-]{32}$/); expect(data.password).not.toBe('weak');
    expect(state.db.auth.admin.createUser.mock.calls[0][0].app_metadata).toEqual({ station_account: true });
    expect(JSON.stringify(data)).not.toContain('@station.');
  });
  it('rolls back a newly created auth identity when station creation fails', async () => {
    state.db.rpc.mockResolvedValueOnce({ error: { code: '23505' } });
    const res = await manage(req('/api/admin/stations', { action: 'create', username: 'security', label: 'Security', role: 'security' }));
    expect(res.status).toBe(409); expect(state.db.auth.admin.deleteUser).toHaveBeenCalledWith(uid);
  });
  it('reset locks/revokes first; provider failure must not finish/unlock or return a password', async () => {
    state.db.auth.admin.updateUserById.mockResolvedValueOnce({ error: {} });
    const res = await manage(req('/api/admin/stations', { action: 'reset', id: uid }));
    expect(res.status).toBe(503);
    expect(state.db.rpc.mock.calls.filter(([name]) => name === 'manage_station_access').map(([, args]) => args.p_action)).toEqual(['reset']);
    expect(await res.json()).not.toHaveProperty('password');
  });
});

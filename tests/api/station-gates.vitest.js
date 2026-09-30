import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { getCurrentUser, requireTeam, requireAdmin, requireFrontDeskOrTeam, requireSecurityOrTeam } from '@/lib/auth-helpers';
import { STATION_COOKIE } from '@/lib/station-policy';
const state = vi.hoisted(() => ({ station: null, present: false, error: null, personalCalls: 0 }));
vi.mock('@/lib/station-session', () => ({
  stationContext: async () => ({ present: state.present, station: state.station }),
  stationUser: station => ({ id: station.user_id, email: null }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ rpc: async () => ({ data: state.station ? [state.station] : [], error: state.error }) }),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => { state.personalCalls++; throw new Error('Personal auth must not handle a station'); },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => { state.personalCalls++; throw new Error('Station must not use personal auth'); },
}));
const request = (path, method = 'GET', origin = 'https://www.sdgatx.com') => new NextRequest(`https://www.sdgatx.com${path}`, {
  method, headers: { cookie: `${STATION_COOKIE}=${'a'.repeat(43)}`, origin },
});
beforeEach(() => {
  state.station = { id: 'station', user_id: 'auth-user', role: 'security', label: 'Security' };
  state.present = true; state.error = null; state.personalCalls = 0;
});
describe('station middleware and server gates', () => {
  it('station identity never inherits personal admin/team powers', async () => {
    expect((await getCurrentUser()).teamRole).toBe('security');
    expect((await requireTeam()).unauthorized).toBe(true);
    expect((await requireAdmin()).unauthorized).toBe(true);
    expect((await requireFrontDeskOrTeam()).unauthorized).toBe(true);
    expect((await requireSecurityOrTeam()).unauthorized).toBe(false);
    state.station.role = 'front_desk';
    expect((await requireFrontDeskOrTeam()).unauthorized).toBe(false);
    expect((await requireSecurityOrTeam()).unauthorized).toBe(true);
    expect(state.personalCalls).toBe(0);
  });
  it('invalid station cookie never falls back to another personal login', async () => {
    state.station = null;
    expect((await getCurrentUser()).user).toBeNull();
    expect((await requireAdmin()).unauthorized).toBe(true);
    expect((await middleware(request('/api/capacity/security', 'POST'))).status).toBe(401);
    expect(state.personalCalls).toBe(0);
  });
  it('direct URL/API attacks are denied before reaching the handler', async () => {
    expect((await middleware(request('/api/admin/stations', 'POST'))).status).toBe(403);
    expect((await middleware(request('/api/tickets/scan', 'POST'))).status).toBe(403);
    expect((await middleware(request('/api/capacity/device/operation?token=anything', 'POST'))).status).toBe(403);
    expect((await middleware(request('/capacity/front-door?token=anything'))).headers.get('location')).toBe('https://www.sdgatx.com/capacity/security');
    expect((await middleware(request('/bananas'))).headers.get('location')).toBe('https://www.sdgatx.com/capacity/security');
    expect((await middleware(request('/api/capacity/security', 'POST'))).status).toBe(200);
    expect((await middleware(request('/api/capacity/security', 'POST', 'https://attacker.example'))).status).toBe(403);
    expect(state.personalCalls).toBe(0);
  });
  it('server gate independently rejects a disallowed request path', async () => {
    expect((await requireSecurityOrTeam(request('/api/admin/stations', 'POST'))).unauthorized).toBe(true);
    expect((await requireSecurityOrTeam(request('/api/capacity/security', 'POST'))).unauthorized).toBe(false);
  });
  it('database errors fail closed', async () => {
    state.error = { message: 'offline' };
    expect((await middleware(request('/api/capacity/security', 'POST'))).status).toBe(401);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { getCurrentUser, requireTeam, requireAdmin, requireFrontDeskOrTeam, requireSecurityOrTeam, requireOrdersDesk } from '@/lib/auth-helpers';
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
  it('Orders & Refunds admits only the Front Desk station on its allowlisted routes', async () => {
    expect((await requireOrdersDesk(request('/api/admin/tickets/refunds', 'POST'))).unauthorized).toBe(true);
    state.station.role = 'front_desk';
    const desk = await requireOrdersDesk(request('/api/admin/tickets/refunds', 'POST'));
    expect(desk.unauthorized).toBe(false);
    expect(desk.deskStation).toBe(true);
    expect(desk.isAdmin).toBe(false);
    expect((await requireOrdersDesk(request('/api/admin/tickets/orders', 'GET'))).unauthorized).toBe(true);
    expect((await requireAdmin(request('/api/admin/tickets/refunds', 'POST'))).unauthorized).toBe(true);
    expect((await middleware(request('/capacity/front-desk/orders'))).status).toBe(200);
    expect((await middleware(request('/bananas/orders'))).headers.get('location')).toBe('https://www.sdgatx.com/capacity/front-desk');
    expect((await middleware(request('/api/admin/tickets/refunds', 'POST'))).status).toBe(200);
    expect((await middleware(request('/api/admin/tickets/refunds', 'POST', 'https://attacker.example'))).status).toBe(403);
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
  it('availability cannot access full calendar, door metadata, or any staff/admin operations', async () => {
    state.station.role = 'calendar_availability';
    for (const gate of [requireTeam, requireAdmin, requireFrontDeskOrTeam, requireSecurityOrTeam]) {
      expect((await gate()).unauthorized).toBe(true);
    }
    for (const path of ['/api/door-session/active','/api/admin/stations','/api/station/guest-search','/api/capacity/security']) {
      expect((await middleware(request(path))).status).toBe(403);
    }
    for (const path of ['/team/calendar','/bananas','/capacity/security','/portal']) {
      expect((await middleware(request(path))).headers.get('location')).toBe('https://www.sdgatx.com/staff/availability');
    }
    expect((await middleware(request('/api/station/availability'))).status).toBe(200);
    expect((await middleware(request('/staff/availability'))).status).toBe(200);
    expect((await middleware(request('/api/station/availability', 'POST'))).status).toBe(403);
    expect(state.personalCalls).toBe(0);
  });
});

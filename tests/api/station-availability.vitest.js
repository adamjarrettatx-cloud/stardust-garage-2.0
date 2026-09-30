import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/station/availability/route';
const state = vi.hoisted(() => ({ station: null, rpc: vi.fn() }));
vi.mock('@/lib/station-session', () => ({ stationContext: async () => ({ station: state.station }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
const days = () => Array.from({ length: 365 }, (_, i) => ({
  date: new Date(Date.UTC(2026,8,30+i)).toISOString().slice(0,10), available: i % 3 === 0,
}));
beforeEach(() => {
  state.station = { role: 'calendar_availability', sessionHash: 'verified-hash' };
  state.rpc.mockReset().mockResolvedValue({ data: days(), error: null });
});
it('returns only date/status; ignores caller hash, dates and injected metadata', async () => {
  state.rpc.mockResolvedValueOnce({ data: days().map(day => ({ ...day, title: 'PRIVATE', id: 'PRIVATE', notes: 'PRIVATE' })) });
  const res = await GET(new Request('https://www.sdgatx.com/api/station/availability?p_hash=attacker&start=2000-01-01'));
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toContain('no-store');
  expect(await res.json()).toEqual({ days: days(), timezone: 'America/Chicago' });
  expect(state.rpc).toHaveBeenCalledWith('station_calendar_availability', { p_hash: 'verified-hash' });
});
it('requires this exact station role independently of middleware', async () => {
  state.station = null;
  expect((await GET()).status).toBe(401);
  for (const role of ['security','front_desk','admin','team','calendar_viewer']) {
    state.station = { role };
    expect((await GET()).status).toBe(403);
  }
  expect(state.rpc).not.toHaveBeenCalled();
});
it('fails closed on RPC failure, empty/partial data and malformed availability', async () => {
  for (const result of [
    { error: { message: 'PRIVATE DATABASE DETAIL' } }, { data: [] }, { data: days().slice(1) },
    { data: days().map((day, i) => i ? day : { ...day, available: 'false' }) },
    { data: days().map((day, i) => i ? day : { ...day, date: '2026-02-30' }) },
    { data: days().map((day, i) => i ? day : days()[1]) },
  ]) {
    state.rpc.mockResolvedValueOnce(result);
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('PRIVATE');
  }
});

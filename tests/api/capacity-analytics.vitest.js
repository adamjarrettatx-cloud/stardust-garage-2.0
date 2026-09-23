import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth-helpers', () => ({ requireAdminMfa: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/capacity/analytics-loader', () => ({ loadCapacityAnalytics: vi.fn() }));
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadCapacityAnalytics } from '@/lib/capacity/analytics-loader';
import { GET } from '../../app/api/admin/capacity-analytics/route.js';

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMfa.mockResolvedValue({ unauthorized: false });
  createAdminClient.mockReturnValue({});
  loadCapacityAnalytics.mockResolvedValue({ report: { buckets: [] } });
});

it.each([{}, { reason: 'mfa_required' }])('rejects non-admin or insufficient-MFA sessions before querying', async (extra) => {
  requireAdminMfa.mockResolvedValue({ unauthorized: true, ...extra });
  const response = await GET(new Request('https://example.test/api/admin/capacity-analytics'));
  expect(response.status).toBe(401);
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(loadCapacityAnalytics).not.toHaveBeenCalled();
});

it('returns an uncached read-only response', async () => {
  const response = await GET(new Request('https://example.test/api/admin/capacity-analytics?mode=live'));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(loadCapacityAnalytics.mock.calls[0][1].get('mode')).toBe('live');
});

it('preserves validation status', async () => {
  loadCapacityAnalytics.mockResolvedValue({ status: 400, error: 'Invalid event' });
  expect((await GET(new Request('https://example.test/api/admin/capacity-analytics'))).status).toBe(400);
});

it('fails closed rather than returning partial history on a loader error', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  loadCapacityAnalytics.mockRejectedValue(new Error('database error'));
  const response = await GET(new Request('https://example.test/api/admin/capacity-analytics'));
  expect(response.status).toBe(500);
  expect((await response.json()).error).toContain('complete capacity history');
  log.mockRestore();
});

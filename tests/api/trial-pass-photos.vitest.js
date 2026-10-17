import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-helpers', () => ({ requireTeam: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

const { requireTeam } = await import('@/lib/auth-helpers');
const { createAdminClient } = await import('@/lib/supabase/admin');
const { clearThumbUrlCache } = await import('@/lib/member-photo');
const { POST } = await import('../../app/api/team/trial-pass/photos/route.js');

const req = (body) => new Request('https://x.test/api/team/trial-pass/photos', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeEach(() => {
  clearThumbUrlCache();
  requireTeam.mockResolvedValue({ unauthorized: false });
  const rows = [{ id: 'p1', profile_photo_path: 'trial-pass/p1/photo.jpg' }, { id: 'p2', profile_photo_path: null }];
  createAdminClient.mockReturnValue({
    from: () => ({ select: () => ({ in: async (_c, ids) => ({ data: rows.filter((r) => ids.includes(r.id)), error: null }) }) }),
    storage: { from: () => ({ createSignedUrls: async (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://img/${p}`, error: null })), error: null }) }) },
  });
});

it('rejects non-team callers', async () => {
  requireTeam.mockResolvedValue({ unauthorized: true });
  expect((await POST(req({ ids: ['p1'] }))).status).toBe(401);
});

it('returns thumbnail links for the requested passes only, never storage paths', async () => {
  const res = await POST(req({ ids: ['p1', 'p2', 'nope', '../x'] }));
  const { photos } = await res.json();
  expect(photos).toEqual({ p1: 'https://img/_thumbs/trial-pass/p1/photo.jpg.webp', p2: null, nope: null });
  expect(res.headers.get('cache-control')).toBe('private, no-store');
});

it('validates the body', async () => {
  expect((await POST(req('nope'))).status).toBe(400);
  expect((await POST(req({ ids: 'p1' }))).status).toBe(400);
  expect((await POST(req({ ids: Array.from({ length: 201 }, (_, i) => `id${i}`) }))).status).toBe(400);
});

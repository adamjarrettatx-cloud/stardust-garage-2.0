import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-helpers', () => ({ requireOwner: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveMemberPhotoUrl, resolveMemberPhotoUrls, clearThumbUrlCache } from '@/lib/member-photo';
import { loadTrialPassAnalytics } from '@/lib/trial-pass-analytics';
import { GET } from '../../app/api/admin/membership/journey/route.js';
import { POST as POST_PHOTOS } from '../../app/api/admin/membership/journey/photos/route.js';
import { parsePhotoKeys, MAX_PHOTO_KEYS } from '@/lib/journey-photos';

let admin;
let tables;
let sign;
let signMany;
let selected;
const date = '2026-09-20T05:00:00Z';

beforeEach(() => {
  vi.clearAllMocks();
  clearThumbUrlCache();
  requireOwner.mockResolvedValue({ unauthorized: false });
  tables = {
    free_accounts: [{ id: 'guest', user_id: 'guest-user', full_name: 'Guest', created_at: date, profile_photo_path: 'private/guest.jpg' }],
    trial_passes: [
      { id: 'ready', full_name: 'Ready Guest', status: 'active', issued_at: date, profile_photo_path: 'private/ready.jpg' },
      { id: 'activated', full_name: 'Activated Guest', status: 'active', issued_at: date, activated_at: date, profile_photo_path: 'private/activated.jpg' },
      { id: 'missing', full_name: 'No Photo', status: 'active', issued_at: date, profile_photo_path: null },
    ],
    member_profiles: ['weekender', 'cowork', 'iykyk'].map((plan) => ({
      id: plan, full_name: plan, created_at: date, is_active: true,
      subscription_status: 'active', subscription_plan: plan,
      profile_photo_path: `private/${plan}.jpg`,
    })),
    trial_pass_checkins: [],
    events: [],
  };
  selected = [];
  sign = vi.fn(async (path) => ({ data: { signedUrl: `https://images.example.test/${path}?signed=temporary` }, error: null }));
  signMany = vi.fn(async (paths) => ({
    data: paths.map((path) => ({ path, error: null, signedUrl: `https://images.example.test/${path}?signed=temporary` })),
    error: null,
  }));
  admin = {
    storage: { from: vi.fn(() => ({ createSignedUrl: sign, createSignedUrls: signMany })) },
    from: vi.fn((table) => {
      const query = {
        select: vi.fn((columns) => { selected.push({ table, columns }); return query; }),
        order: vi.fn(() => query),
        eq: vi.fn(() => query),
        limit: vi.fn(async () => ({ data: tables[table] || [], error: null })),
        range: vi.fn(async () => ({ data: tables[table] || [], error: null })),
        in: vi.fn(async (_col, ids) => ({ data: (tables[table] || []).filter((r) => ids.includes(r.id)), error: null })),
      };
      return query;
    }),
  };
  createAdminClient.mockReturnValue(admin);
});

it('returns the URL string, not the signed-url wrapper object', async () => {
  const result = await resolveMemberPhotoUrl(admin, { profile_photo_path: 'private/guest.jpg' });
  expect(result).toBe('https://images.example.test/private/guest.jpg?signed=temporary');
  expect(admin.storage.from).toHaveBeenCalledWith('profile-photos');
  expect(sign).toHaveBeenCalledWith('private/guest.jpg', 300);
});

it('handles missing photos and signing failures with a legacy fallback', async () => {
  expect(await resolveMemberPhotoUrl(admin, null)).toBeNull();
  expect(await resolveMemberPhotoUrl(admin, {})).toBeNull();
  sign.mockResolvedValue({ data: null, error: { message: 'missing' } });
  expect(await resolveMemberPhotoUrl(admin, { profile_photo_path: 'missing' })).toBeNull();
  expect(await resolveMemberPhotoUrl(admin, { profile_photo_path: 'missing', photo_url: 'https://images.example.test/legacy.jpg' }))
    .toBe('https://images.example.test/legacy.jpg');
});

it('signs lists with one bulk Storage request per 100 photos', async () => {
  const rows = Array.from({ length: 250 }, (_, id) => ({ id: String(id), profile_photo_path: `private/${id}.jpg` }));
  const result = await resolveMemberPhotoUrls(admin, rows);
  expect(result.size).toBe(250);
  expect(signMany).toHaveBeenCalledTimes(3);
  expect(signMany).toHaveBeenCalledWith(expect.any(Array), 300);
  expect(sign).not.toHaveBeenCalled();
  expect(result.get('249')).toBe('https://images.example.test/private/249.jpg?signed=temporary');
});

it('keeps per-row legacy fallbacks when individual bulk entries fail', async () => {
  signMany.mockResolvedValue({ data: [{ path: 'private/a.jpg', error: 'Object not found', signedUrl: null }], error: null });
  const result = await resolveMemberPhotoUrls(admin, [
    { id: 'a', profile_photo_path: 'private/a.jpg', photo_url: 'https://images.example.test/legacy.jpg' },
    { id: 'b', profile_photo_path: null },
  ]);
  expect(result.get('a')).toBe('https://images.example.test/legacy.jpg');
  expect(result.get('b')).toBeNull();
});

it('falls back to single-path signing when a bulk request fails outright', async () => {
  signMany.mockResolvedValue({ data: null, error: { message: 'storage down' } });
  const rows = Array.from({ length: 3 }, (_, id) => ({ id: String(id), profile_photo_path: `private/${id}.jpg` }));
  const result = await resolveMemberPhotoUrls(admin, rows);
  expect(sign).toHaveBeenCalledTimes(3);
  expect(result.get('2')).toBe('https://images.example.test/private/2.jpg?signed=temporary');
});

it('rejects unauthorized Journey requests before querying or signing', async () => {
  requireOwner.mockResolvedValue({ unauthorized: true });
  expect((await GET()).status).toBe(401);
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(sign).not.toHaveBeenCalled();
});

it('serves all six Journey tabs without signing photos or exposing raw paths', async () => {
  const response = await GET();
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const payload = await response.json();
  expect(sign).not.toHaveBeenCalled();
  expect(signMany).not.toHaveBeenCalled();
  expect(JSON.stringify(payload)).not.toContain('private/');
  for (const tab of payload.tab_order) {
    expect(payload.tabs[tab].length).toBeGreaterThan(0);
    for (const row of payload.tabs[tab]) {
      expect(row).not.toHaveProperty('photo_path');
      expect(row).not.toHaveProperty('profile_photo_path');
      expect(row).not.toHaveProperty('photo_url');
      expect(row.has_photo).toBe(row.id !== 'missing');
    }
  }
});

const photoRequest = (body) => new Request('http://localhost/api/admin/membership/journey/photos', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

it('rejects unauthorized Journey photo requests before querying or signing', async () => {
  requireOwner.mockResolvedValue({ unauthorized: true });
  expect((await POST_PHOTOS(photoRequest({ keys: ['trial:ready'] }))).status).toBe(401);
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(signMany).not.toHaveBeenCalled();
});

it('signs only the requested Journey cards, using server-side paths', async () => {
  const response = await POST_PHOTOS(photoRequest({
    keys: ['trial:ready', 'account:guest', 'member:weekender', 'trial:missing', 'trial:unknown-id', 'bogus:x'],
  }));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const payload = await response.json();
  expect(payload.ttl_seconds).toBe(300);
  expect(Object.keys(payload.photos).sort()).toEqual(
    ['account:guest', 'member:weekender', 'trial:missing', 'trial:ready', 'trial:unknown-id'],
  );
  expect(payload.photos['trial:ready']).toBe('https://images.example.test/_thumbs/private/ready.jpg.webp?signed=temporary');
  expect(payload.photos['account:guest']).toBe('https://images.example.test/_thumbs/private/guest.jpg.webp?signed=temporary');
  expect(payload.photos['member:weekender']).toBe('https://images.example.test/_thumbs/private/weekender.jpg.webp?signed=temporary');
  expect(payload.photos['trial:missing']).toBeNull();
  expect(payload.photos['trial:unknown-id']).toBeNull();
  // List cards get the small thumbnail copies; originals are not signed
  // when every thumbnail already exists.
  expect(signMany).toHaveBeenCalledTimes(1);
  expect(signMany.mock.calls[0][0].sort()).toEqual(['_thumbs/private/guest.jpg.webp', '_thumbs/private/ready.jpg.webp', '_thumbs/private/weekender.jpg.webp']);
  expect(JSON.stringify(payload)).not.toMatch(/"private\//);
});

it('validates Journey photo request bodies', async () => {
  expect((await POST_PHOTOS(photoRequest('not json'))).status).toBe(400);
  expect((await POST_PHOTOS(photoRequest({ keys: 'trial:ready' }))).status).toBe(400);
  const tooMany = Array.from({ length: MAX_PHOTO_KEYS + 1 }, (_, i) => `trial:id-${i}`);
  expect((await POST_PHOTOS(photoRequest({ keys: tooMany }))).status).toBe(400);
  expect(signMany).not.toHaveBeenCalled();
  const parsed = parsePhotoKeys(['trial:a', 'trial:a', 'trial:../x', 'member:b', 7]);
  expect([...parsed.trial]).toEqual(['a']);
  expect([...parsed.member]).toEqual(['b']);
});

it('marks which trial rows have photos without signing any on the page', async () => {
  const payload = await loadTrialPassAnalytics({ admin, includePhotos: true });
  expect(selected.find((s) => s.table === 'trial_passes').columns).toContain('profile_photo_path');
  for (const row of [...payload.recent, ...payload.byEvent.flatMap((event) => event.signups)]) {
    expect(row).not.toHaveProperty('profile_photo_path');
    expect(row).not.toHaveProperty('photoUrl');
    expect(row.hasPhoto).toBe((row.id || row.passId) !== 'missing');
  }
  expect(sign).not.toHaveBeenCalled();
  expect(signMany).not.toHaveBeenCalled();
});

it('keeps CSV and non-visual analytics callers free of photo links and signing requests', async () => {
  const payload = await loadTrialPassAnalytics({ admin });
  expect(selected.find((s) => s.table === 'trial_passes').columns).not.toContain('profile_photo_path');
  expect(sign).not.toHaveBeenCalled();
  expect(signMany).not.toHaveBeenCalled();
  expect(JSON.stringify(payload)).not.toContain('photoUrl');
  expect(JSON.stringify(payload)).not.toContain('private/');
});

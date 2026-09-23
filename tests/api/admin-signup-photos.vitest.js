import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-helpers', () => ({ requireOwner: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveMemberPhotoUrl, resolveMemberPhotoUrls } from '@/lib/member-photo';
import { loadTrialPassAnalytics } from '@/lib/trial-pass-analytics';
import { GET } from '../../app/api/admin/membership/journey/route.js';

let admin;
let tables;
let sign;
let selected;
const date = '2026-09-20T05:00:00Z';

beforeEach(() => {
  vi.clearAllMocks();
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
  admin = {
    storage: { from: vi.fn(() => ({ createSignedUrl: sign })) },
    from: vi.fn((table) => {
      const query = {
        select: vi.fn((columns) => { selected.push({ table, columns }); return query; }),
        order: vi.fn(() => query),
        eq: vi.fn(() => query),
        limit: vi.fn(async () => ({ data: tables[table] || [], error: null })),
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

it('resolves lists in bounded batches and keeps per-row fallbacks', async () => {
  const rows = Array.from({ length: 55 }, (_, id) => ({ id: String(id), profile_photo_path: `private/${id}.jpg` }));
  const result = await resolveMemberPhotoUrls(admin, rows);
  expect(result.size).toBe(55);
  expect(sign).toHaveBeenCalledTimes(55);
  expect(typeof result.get('54')).toBe('string');
});

it('rejects unauthorized Journey requests before querying or signing', async () => {
  requireOwner.mockResolvedValue({ unauthorized: true });
  expect((await GET()).status).toBe(401);
  expect(createAdminClient).not.toHaveBeenCalled();
  expect(sign).not.toHaveBeenCalled();
});

it('serves signed photo strings across all six Journey tabs without raw path fields', async () => {
  const response = await GET();
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  const payload = await response.json();
  for (const tab of payload.tab_order) {
    expect(payload.tabs[tab].length).toBeGreaterThan(0);
    for (const row of payload.tabs[tab]) {
      expect(row).not.toHaveProperty('photo_path');
      expect(row).not.toHaveProperty('profile_photo_path');
      if (row.id === 'missing') expect(row.photo_url).toBeNull();
      else expect(row.photo_url).toMatch(/^https:\/\/images\.example\.test\//);
    }
  }
});

it('includes photos in recent and by-event trial signup rows when opted in', async () => {
  const payload = await loadTrialPassAnalytics({ admin, includePhotos: true });
  expect(selected.find((s) => s.table === 'trial_passes').columns).toContain('profile_photo_path');
  for (const row of [...payload.recent, ...payload.byEvent.flatMap((event) => event.signups)]) {
    expect(row).not.toHaveProperty('profile_photo_path');
    if ((row.id || row.passId) === 'missing') expect(row.photoUrl).toBeNull();
    else expect(row.photoUrl).toMatch(/^https:\/\/images\.example\.test\//);
  }
  expect(sign).toHaveBeenCalledTimes(2);
});

it('keeps CSV and non-visual analytics callers free of photo links and signing requests', async () => {
  const payload = await loadTrialPassAnalytics({ admin });
  expect(selected.find((s) => s.table === 'trial_passes').columns).not.toContain('profile_photo_path');
  expect(sign).not.toHaveBeenCalled();
  expect(JSON.stringify(payload)).not.toContain('photoUrl');
  expect(JSON.stringify(payload)).not.toContain('private/');
});

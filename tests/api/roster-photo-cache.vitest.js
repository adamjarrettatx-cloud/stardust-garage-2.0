import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let minted = 0;
vi.mock('@/lib/profile-photo', () => ({
  PROFILE_PHOTO_BUCKET: 'profile-photos',
  createProfilePhotoSignedUrl: async (_admin, path, ttl) => ({ signedUrl: `https://cdn.invalid/${path}?n=${++minted}&ttl=${ttl}` }),
}));
import { clearRosterPhotoCache, prewarmRosterPhotos, rosterPhotoUrl, ROSTER_PHOTO_TTL_SECONDS } from '@/lib/capacity/roster-photo-cache';
import { loadRoster } from '@/lib/capacity/arrival-roster-server';

function storageAdmin() {
  const batches = [];
  return { batches, storage: { from: () => ({ createSignedUrls: async (paths, ttl) => {
    batches.push({ paths, ttl });
    return { data: paths.map(path => ({ path, signedUrl: `https://cdn.invalid/${path}?batch=${batches.length}`, error: null })), error: null };
  } }) } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-04T02:00:00Z')); clearRosterPhotoCache(); minted = 0; });
afterEach(() => vi.useRealTimers());

describe('roster photo URL reuse', () => {
  it('returns the same URL across polls instead of re-minting', async () => {
    const a = await rosterPhotoUrl({}, 'trial-pass/p1/photo.jpg', 't1');
    vi.advanceTimersByTime(15_000);
    const b = await rosterPhotoUrl({}, 'trial-pass/p1/photo.jpg', 't1');
    expect(b).toBe(a);
    expect(minted).toBe(1);
    expect(a).toContain(`ttl=${ROSTER_PHOTO_TTL_SECONDS}`);
  });
  it('re-mints before expiry so a served URL always has at least 10 minutes left', async () => {
    const a = await rosterPhotoUrl({}, 'p.jpg');
    vi.advanceTimersByTime(19 * 60_000);
    expect(await rosterPhotoUrl({}, 'p.jpg')).toBe(a);
    vi.advanceTimersByTime(61_000);
    expect(await rosterPhotoUrl({}, 'p.jpg')).not.toBe(a);
  });
  it('a re-uploaded photo at the same path gets a new URL immediately', async () => {
    const a = await rosterPhotoUrl({}, 'u1/photo.jpg', '2026-10-04T01:00:00Z');
    const b = await rosterPhotoUrl({}, 'u1/photo.jpg', '2026-10-04T01:59:00Z');
    expect(b).not.toBe(a);
  });
  it('signs uncached photos in one batched request and skips cached ones', async () => {
    const admin = storageAdmin();
    await prewarmRosterPhotos(admin, [{ path: 'a.jpg' }, { path: 'b.jpg', version: 'v' }, { path: 'a.jpg' }, { path: null }]);
    expect(admin.batches).toHaveLength(1);
    expect(admin.batches[0].paths).toEqual(['a.jpg', 'b.jpg']);
    expect(await rosterPhotoUrl(admin, 'b.jpg', 'v')).toContain('batch=1');
    await prewarmRosterPhotos(admin, [{ path: 'a.jpg' }, { path: 'b.jpg', version: 'v' }]);
    expect(admin.batches).toHaveLength(1);
    expect(minted).toBe(0);
  });
  it('falls back to single signing when a batch fails', async () => {
    const admin = { storage: { from: () => ({ createSignedUrls: async () => ({ data: null, error: { message: 'down' } }) }) } };
    await prewarmRosterPhotos(admin, [{ path: 'a.jpg' }]);
    expect(await rosterPhotoUrl(admin, 'a.jpg')).toContain('n=1');
  });
});

describe('roster polling end-to-end', () => {
  it('repeated roster polls return stable photo URLs with a single batch sign', async () => {
    const admin = storageAdmin();
    const tables = {
      trial_passes: [{ id:'p1', full_name:'Jordan Rivera', user_id:null, guest_profile_id:null, member_profile_id:null,
        issued_at:'2026-10-04T01:00:00Z', status:'active', signup_expires_at:'2026-11-01T00:00:00Z', activated_at:null,
        profile_photo_path:'trial-pass/p1/photo.jpg', profile_photo_uploaded_at:'2026-10-04T01:00:00Z' }],
      front_desk_arrivals: [], door_sessions: [], events: [], member_profiles: [], guest_profiles: [], free_accounts: [],
    };
    admin.from = table => { const rows = tables[table] || []; const b = { select:()=>b, eq:()=>b, is:()=>b, in:()=>b, gte:()=>b, ilike:()=>b, order:()=>b, limit:()=>b,
      then:(res, rej) => Promise.resolve({ data: rows }).then(res, rej) }; return b; };
    const first = await loadRoster(admin, { now: new Date() });
    vi.advanceTimersByTime(15_000);
    const second = await loadRoster(admin, { now: new Date() });
    expect(first.signins[0].photo_url).toBeTruthy();
    expect(second.signins[0].photo_url).toBe(first.signins[0].photo_url);
    expect(admin.batches).toHaveLength(1);
    expect(minted).toBe(0);
  });
});

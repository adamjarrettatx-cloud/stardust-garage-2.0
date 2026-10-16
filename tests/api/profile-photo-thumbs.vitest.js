import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('next/server', () => ({ after: (fn) => { fn(); } }));

const { thumbPathFor, renderThumb, refreshProfilePhotoThumb, backfillProfilePhotoThumbs, THUMB_SIZE } =
  await import('@/lib/profile-photo-thumbs');
const { resolveMemberPhotoUrls } = await import('@/lib/member-photo');

function fakeStorage(initial = {}) {
  const objects = new Map(Object.entries(initial));
  const calls = { upload: [], remove: [], download: [] };
  const bucket = {
    async createSignedUrls(paths) {
      return { data: paths.map((p) => (objects.has(p)
        ? { path: p, signedUrl: `https://signed/${p}`, error: null }
        : { path: p, signedUrl: null, error: 'Either the object does not exist' })), error: null };
    },
    async createSignedUrl(p) {
      return objects.has(p) ? { data: { signedUrl: `https://signed/${p}` }, error: null } : { data: null, error: { message: 'missing' } };
    },
    async download(p) {
      calls.download.push(p);
      const buf = objects.get(p);
      if (!buf) return { data: null, error: { message: 'missing' } };
      return { data: new Blob([buf]), error: null };
    },
    async upload(p, body, opts) { calls.upload.push([p, opts]); objects.set(p, body); return { error: null }; },
    async remove(paths) { calls.remove.push(paths); for (const p of paths) objects.delete(p); return { data: [], error: null }; },
  };
  return { objects, calls, admin: { storage: { from: () => bucket } } };
}

const bigPhoto = () => sharp({ create: { width: 3000, height: 4000, channels: 3, background: '#888' } }).jpeg({ quality: 95 }).toBuffer();

describe('profile photo thumbnails', () => {
  it('maps originals to a private _thumbs/ path and never thumbnails a thumbnail', () => {
    expect(thumbPathFor('abc/photo.jpg')).toBe('_thumbs/abc/photo.jpg.webp');
    expect(thumbPathFor('_thumbs/abc/photo.jpg.webp')).toBeNull();
    expect(thumbPathFor('')).toBeNull();
  });

  it('renders a small square WebP', async () => {
    const out = await renderThumb(await bigPhoto());
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(THUMB_SIZE);
    expect(meta.height).toBe(THUMB_SIZE);
    expect(out.length).toBeLessThan(60 * 1024);
  });

  it('removes the old thumbnail when a replacement cannot be decoded', async () => {
    const s = fakeStorage({ '_thumbs/u/photo.jpg.webp': Buffer.from('old') });
    const made = await refreshProfilePhotoThumb(s.admin, 'u/photo.jpg', Buffer.from('not an image'));
    expect(made).toBe(false);
    expect(s.objects.has('_thumbs/u/photo.jpg.webp')).toBe(false);
  });

  it('list mode returns thumbnails when present and falls back to the original otherwise', async () => {
    const s = fakeStorage({
      'a/photo.jpg': await bigPhoto(),
      '_thumbs/a/photo.jpg.webp': Buffer.from('thumb'),
      'b/photo.jpg': await bigPhoto(),
    });
    const map = await resolveMemberPhotoUrls(s.admin, [
      { id: 1, profile_photo_path: 'a/photo.jpg' },
      { id: 2, profile_photo_path: 'b/photo.jpg' },
      { id: 3, profile_photo_path: null, photo_url: 'https://legacy/x.jpg' },
    ], { size: 'thumb' });
    expect(map.get(1)).toBe('https://signed/_thumbs/a/photo.jpg.webp');
    expect(map.get(2)).toBe('https://signed/b/photo.jpg');
    expect(map.get(3)).toBe('https://legacy/x.jpg');
    await vi.waitFor(() => expect(s.objects.has('_thumbs/b/photo.jpg.webp')).toBe(true));
  });

  it('full mode still returns originals', async () => {
    const s = fakeStorage({ 'a/photo.jpg': Buffer.from('x'), '_thumbs/a/photo.jpg.webp': Buffer.from('t') });
    const map = await resolveMemberPhotoUrls(s.admin, [{ id: 1, profile_photo_path: 'a/photo.jpg' }]);
    expect(map.get(1)).toBe('https://signed/a/photo.jpg');
  });

  it('backfill builds only the missing thumbnails', async () => {
    const s = fakeStorage({
      'a/photo.jpg': await bigPhoto(),
      '_thumbs/a/photo.jpg.webp': Buffer.from('t'),
      'b/photo.jpg': await bigPhoto(),
    });
    const rows = { trial_passes: [{ profile_photo_path: 'a/photo.jpg' }], free_accounts: [{ profile_photo_path: 'b/photo.jpg' }] };
    s.admin.from = (table) => ({ select: () => ({ not: () => ({ range: async () => ({ data: rows[table] || [], error: null }) }) }) });
    const { createProfilePhotoSignedUrls } = await import('@/lib/profile-photo');
    const result = await backfillProfilePhotoThumbs(s.admin, { signUrls: createProfilePhotoSignedUrls });
    expect(result).toEqual({ photos: 2, missing: 1, made: 1 });
    expect(s.calls.download).toEqual(['b/photo.jpg']);
  });
});

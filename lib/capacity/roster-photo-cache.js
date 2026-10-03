import { PROFILE_PHOTO_BUCKET, createProfilePhotoSignedUrl } from '@/lib/profile-photo';

// Front-desk rosters poll every 15-20 seconds. Minting a fresh signed URL for
// every guest on every poll forces a storage lookup per photo AND changes the
// <img src>, so the browser re-downloads every photo each refresh. On a busy
// night that drained the database's Disk IO budget. Reuse one signed URL per
// photo for most of its lifetime so the URL (and the browser's copy) is stable.
export const ROSTER_PHOTO_TTL_SECONDS = 30 * 60;
// Re-mint once fewer than 10 minutes remain, so a URL handed to the browser is
// always valid for at least 10 more minutes (polls run every 15-20 seconds).
const MIN_REMAINING_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 3000;
const BATCH_SIZE = 100;
const cache = new Map();

// The version (upload timestamp) is part of the key, so a re-uploaded photo at
// the same storage path gets a new URL immediately instead of a stale image.
const keyFor = (path, version) => `${path}|${version || ''}`;

function fresh(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt - Date.now() < MIN_REMAINING_MS) { cache.delete(key); return null; }
  return hit.url;
}

function remember(key, url) {
  cache.delete(key);
  cache.set(key, { url, expiresAt: Date.now() + ROSTER_PHOTO_TTL_SECONDS * 1000 });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

// Sign every uncached photo in as few storage requests as possible.
// Failures are silent: callers fall back to a single sign or a placeholder.
export async function prewarmRosterPhotos(admin, items) {
  const pending = new Map();
  for (const { path, version } of items) {
    if (!path) continue;
    const key = keyFor(path, version);
    if (!fresh(key)) pending.set(key, path);
  }
  const bucket = admin?.storage?.from?.(PROFILE_PHOTO_BUCKET);
  if (!pending.size || typeof bucket?.createSignedUrls !== 'function') return;
  const entries = [...pending.entries()];
  for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
    const slice = entries.slice(offset, offset + BATCH_SIZE);
    try {
      const { data, error } = await bucket.createSignedUrls(slice.map(([, path]) => path), ROSTER_PHOTO_TTL_SECONDS);
      if (error || !Array.isArray(data)) continue;
      const byPath = new Map(data.filter(r => r?.signedUrl && !r.error).map(r => [r.path, r.signedUrl]));
      for (const [key, path] of slice) if (byPath.has(path)) remember(key, byPath.get(path));
    } catch { /* fall back to per-photo signing */ }
  }
}

export async function rosterPhotoUrl(admin, path, version) {
  if (!path) return null;
  const key = keyFor(path, version);
  const hit = fresh(key);
  if (hit) return hit;
  const signed = await createProfilePhotoSignedUrl(admin, path, ROSTER_PHOTO_TTL_SECONDS);
  if (!signed?.signedUrl) return null;
  remember(key, signed.signedUrl);
  return signed.signedUrl;
}

export function clearRosterPhotoCache() { cache.clear(); }

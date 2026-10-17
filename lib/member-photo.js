import { after } from 'next/server';
import { createProfilePhotoSignedUrl, createProfilePhotoSignedUrls } from '@/lib/profile-photo';
import { generateProfilePhotoThumbs, thumbPathFor } from '@/lib/profile-photo-thumbs';

// Most thumbnails a single list request will build in the background. The
// cron backfill handles the long tail; this keeps one page view cheap.
// Kept small: Storage's connection pool is shared with door and time-clock
// photo lookups.
const LAZY_THUMBS_PER_REQUEST = 6;

// Thumbnail links live 1 hour and are reused until 10 minutes remain. A
// stable URL lets the browser reuse its cached copy (thumbnails are stored
// with a 1-year cache header) instead of re-downloading every photo on every
// visit, which a fresh signature per request forced. Originals keep the
// 5-minute links.
export const THUMB_URL_TTL_SECONDS = 60 * 60;
const THUMB_URL_MIN_REMAINING_MS = 10 * 60 * 1000;
const THUMB_URL_CACHE_MAX = 5000;
const thumbUrlCache = new Map(); // thumbPath -> { url, expiresAt }

function cachedThumbUrl(path) {
  const hit = thumbUrlCache.get(path);
  if (!hit) return null;
  if (hit.expiresAt - Date.now() < THUMB_URL_MIN_REMAINING_MS) { thumbUrlCache.delete(path); return null; }
  return hit.url;
}
function rememberThumbUrl(path, url) {
  thumbUrlCache.delete(path);
  thumbUrlCache.set(path, { url, expiresAt: Date.now() + THUMB_URL_TTL_SECONDS * 1000 });
  while (thumbUrlCache.size > THUMB_URL_CACHE_MAX) thumbUrlCache.delete(thumbUrlCache.keys().next().value);
}
export function clearThumbUrlCache() { thumbUrlCache.clear(); }
export function forgetThumbUrl(thumbPath) { thumbUrlCache.delete(thumbPath); }

function scheduleThumbs(admin, paths) {
  if (!paths.length) return;
  const run = () => generateProfilePhotoThumbs(admin, paths, { limit: LAZY_THUMBS_PER_REQUEST, concurrency: 1 });
  try {
    after(run);
  } catch {
    // Outside a request scope (scripts/tests): don't block the caller.
    run().catch(() => {});
  }
}

// Resolve the best photo URL for a member profile row for display in admin UIs
// (bananas members list, member detail page, applications list).
//
// Preference order:
//   1. profile_photo_path in the PRIVATE profile-photos bucket → mint a signed URL.
//      This is what every approval after PR E writes to. Signed URL TTL is short
//      (5 min) so a leaked link expires quickly.
//   2. photo_url — the older PUBLIC column, populated pre-PR E from the
//      application row. Kept for backward compat on legacy rows only.
//   3. null → caller renders initials fallback.
//
// Never returns the raw profile_photo_path — the URL returned is either a
// signed URL from the private bucket or the legacy public URL. Both are safe
// for the caller to render as <img src=...>.

export async function resolveMemberPhotoUrl(admin, row) {
  if (!row) return null;

  if (row.profile_photo_path) {
    try {
      const signed = await createProfilePhotoSignedUrl(admin, row.profile_photo_path);
      if (signed?.signedUrl) return signed.signedUrl;
    } catch (err) {
      console.error('[member-photo.signed-url]', err?.message || err);
      // Fall through to the legacy column if signing fails so an outage of
      // the storage API does not blank every avatar on the admin page.
    }
  }

  return row.photo_url || null;
}

// Bulk version for lists. Returns Map<row.id, displayUrl>. Private paths are
// signed through the batched Storage endpoint (one request per 100 photos)
// rather than one request per row. Rows whose path fails to sign fall
// through to that row's legacy photo_url so one bad path never blanks the
// whole page.
export async function resolveMemberPhotoUrls(admin, rows, { size = 'full' } = {}) {
  const map = new Map();
  if (!Array.isArray(rows) || rows.length === 0) return map;

  const valid = rows.filter((row) => row?.id);
  const paths = valid.map((row) => row.profile_photo_path).filter(Boolean);
  let signed = new Map();

  if (paths.length && size === 'thumb') {
    // List views: prefer the small WebP copy. Originals are signed only for
    // rows whose thumbnail doesn't exist yet, and those thumbnails are built
    // after the response so the next load gets the small version.
    const thumbFor = new Map(paths.map((p) => [p, thumbPathFor(p)]).filter(([, t]) => t));
    const thumbs = new Map();
    const toSign = [];
    for (const t of thumbFor.values()) {
      const hit = cachedThumbUrl(t);
      if (hit) thumbs.set(t, hit); else toSign.push(t);
    }
    if (toSign.length) {
      try {
        const fresh = await createProfilePhotoSignedUrls(admin, toSign, THUMB_URL_TTL_SECONDS, { quiet: true });
        for (const [t, url] of fresh) { thumbs.set(t, url); rememberThumbUrl(t, url); }
      } catch (err) {
        console.error('[member-photo.thumb-sign]', err?.message || err);
      }
    }
    const missing = paths.filter((p) => !thumbs.has(thumbFor.get(p)));
    if (missing.length) {
      try {
        signed = await createProfilePhotoSignedUrls(admin, missing);
      } catch (err) {
        console.error('[member-photo.bulk-signed-url]', err?.message || err);
      }
      scheduleThumbs(admin, missing);
    }
    for (const p of paths) {
      const t = thumbs.get(thumbFor.get(p));
      if (t) signed.set(p, t);
    }
  } else if (paths.length) {
    try {
      signed = await createProfilePhotoSignedUrls(admin, paths);
    } catch (err) {
      console.error('[member-photo.bulk-signed-url]', err?.message || err);
    }
  }

  for (const row of valid) {
    const url = (row.profile_photo_path && signed.get(row.profile_photo_path)) || row.photo_url || null;
    map.set(row.id, url);
  }

  return map;
}

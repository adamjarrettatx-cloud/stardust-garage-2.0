// Small list-size copies of private profile photos.
//
// Why: admin lists (Membership Journey, Trial Passes, Members, Applications)
// render photos at 44–144px, but the stored originals are phone selfies of up
// to 5 MB each. Downloading dozens of originals to fill small boxes is what
// made those pages slow, even after URL signing moved off the critical path.
//
// Each original at `<path>` gets one 320px WebP thumbnail at
// `_thumbs/<path>.webp` in the same private bucket. Thumbnails stay private:
// they are only ever handed out as short-lived signed URLs, and the
// `_thumbs/` prefix is outside every per-user storage folder, so only the
// service role can read or write it.
//
// Freshness: originals are replaced in place (`<user>/photo.jpg`), so every
// server upload route calls `refreshProfilePhotoThumb()` after writing and
// every delete path calls `removeProfilePhotoThumbs()`. Missing thumbnails
// are generated lazily (in the background, after the response) the first
// time a list asks for them, and a cron backfills the rest. Until a
// thumbnail exists the list simply receives the original, as before.

import { PROFILE_PHOTO_BUCKET } from '@/lib/profile-photo';

export const THUMB_PREFIX = '_thumbs/';
export const THUMB_SIZE = 320; // 2x the largest list box (144px)
const THUMB_QUALITY = 72;
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

export function thumbPathFor(path) {
  if (typeof path !== 'string' || !path || path.startsWith(THUMB_PREFIX)) return null;
  return `${THUMB_PREFIX}${path}.webp`;
}

// sharp is a native module. Vercel only bundles its binaries into API
// functions (next.config.mjs outputFileTracingIncludes), so admin *pages*
// that list photos must never load it at import time — a static import
// crashed /team/trial-pass/analytics, /bananas/members and
// /bananas/applications on Oct 16, 2026. Load it lazily, only when a
// thumbnail is actually being built; if it can't load, thumbnail generation
// is skipped (lists fall back to originals) and API routes/cron build it.
let sharpPromise = null;
async function loadSharp() {
  if (!sharpPromise) {
    sharpPromise = import('sharp').then((m) => m.default || m).catch((err) => {
      sharpPromise = null;
      throw err;
    });
  }
  return sharpPromise;
}

// Pure image step, exported for tests.
export async function renderThumb(input) {
  const sharp = await loadSharp();
  return sharp(input, { failOn: 'none', limitInputPixels: 80_000_000 })
    .rotate() // honour EXIF orientation from phone cameras
    .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'attention' })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();
}

// In-process guards so one busy page doesn't queue the same photo twice and
// an undecodable original (e.g. some HEIC) isn't retried on every load.
const inFlight = new Set();
const failedUntil = new Map();
const FAILURE_BACKOFF_MS = 6 * 60 * 60 * 1000;

// Build (or rebuild) the thumbnail for one original. Never throws.
export async function generateProfilePhotoThumb(admin, path, { input } = {}) {
  const thumbPath = thumbPathFor(path);
  if (!admin || !thumbPath || inFlight.has(path)) return false;
  const blockedUntil = failedUntil.get(path);
  if (!input && blockedUntil && blockedUntil > Date.now()) return false;
  // Where sharp can't load (admin pages), stop before downloading anything.
  try { await loadSharp(); } catch { return false; }
  inFlight.add(path);
  try {
    const bucket = admin.storage.from(PROFILE_PHOTO_BUCKET);
    let source = input;
    if (!source) {
      const { data, error } = await bucket.download(path);
      if (error || !data) throw new Error(error?.message || 'download failed');
      if (typeof data.size === 'number' && data.size > MAX_SOURCE_BYTES) throw new Error('original too large');
      source = Buffer.from(await data.arrayBuffer());
    }
    const thumb = await renderThumb(source);
    const { error: uploadError } = await bucket.upload(thumbPath, thumb, {
      contentType: 'image/webp',
      upsert: true,
      cacheControl: '31536000',
    });
    if (uploadError) throw new Error(uploadError.message);
    failedUntil.delete(path);
    return true;
  } catch (err) {
    failedUntil.set(path, Date.now() + FAILURE_BACKOFF_MS);
    if (failedUntil.size > 5000) failedUntil.delete(failedUntil.keys().next().value);
    console.warn('[profile-photo-thumb]', path, err?.message || err);
    return false;
  } finally {
    inFlight.delete(path);
  }
}

// Generate thumbnails for several originals with bounded concurrency.
export async function generateProfilePhotoThumbs(admin, paths, { concurrency = 4, limit = 30, deadline = Infinity } = {}) {
  const queue = [...new Set((paths || []).filter(Boolean))].slice(0, limit);
  let made = 0;
  const worker = async () => {
    // `deadline` (epoch ms) stops starting new photos so a cron run finishes
    // inside its function time limit; the next run picks up the rest.
    while (queue.length && Date.now() < deadline) {
      const path = queue.shift();
      if (await generateProfilePhotoThumb(admin, path)) made += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return made;
}

// Called by upload routes right after the original is written. The upload
// buffer is reused so the original isn't downloaded again. Never throws.
export async function refreshProfilePhotoThumb(admin, path, input) {
  const thumbPath = thumbPathFor(path);
  if (!admin || !thumbPath) return false;
  failedUntil.delete(path);
  // Drop this instance's reusable link so lists pick up the new photo.
  try { (await import('@/lib/member-photo')).forgetThumbUrl?.(thumbPath); } catch { /* noop */ }
  const made = await generateProfilePhotoThumb(admin, path, { input });
  if (!made) {
    // A stale thumbnail of the previous photo must never outlive it.
    try { await admin.storage.from(PROFILE_PHOTO_BUCKET).remove([thumbPath]); } catch { /* noop */ }
  }
  return made;
}

// Paths of thumbnails belonging to the given originals (for delete paths).
export function thumbPathsFor(paths) {
  return (paths || []).map(thumbPathFor).filter(Boolean);
}

export async function removeProfilePhotoThumbs(admin, paths) {
  const thumbs = thumbPathsFor(paths);
  if (!admin || thumbs.length === 0) return;
  try { await admin.storage.from(PROFILE_PHOTO_BUCKET).remove(thumbs); }
  catch (err) { console.warn('[profile-photo-thumb.remove]', err?.message || err); }
}

// ── Backfill ────────────────────────────────────────────────────────────────
// Tables whose rows point at originals in the profile-photos bucket.
export const THUMB_SOURCE_TABLES = ['trial_passes', 'free_accounts', 'member_profiles', 'membership_applications'];
const BACKFILL_PAGE = 1000;

// One cron tick: find originals without a thumbnail and build up to `limit`
// of them. Re-checking is cheap (one signing request per 100 photos), so no
// progress table is needed; the job naturally goes quiet once caught up.
// 2 at a time, daytime only (vercel.json): 8 and then 4 concurrent briefly
// exhausted Supabase Storage's database connections (Oct 17, 2026), which
// also hit time-clock photo lookups. Keep it off during venue hours.
export async function backfillProfilePhotoThumbs(admin, { limit = 300, concurrency = 2, budgetMs = 45_000, signUrls } = {}) {
  const deadline = Date.now() + budgetMs;
  const paths = new Set();
  for (const table of THUMB_SOURCE_TABLES) {
    for (let from = 0; ; from += BACKFILL_PAGE) {
      const { data, error } = await admin
        .from(table)
        .select('profile_photo_path')
        .not('profile_photo_path', 'is', null)
        .range(from, from + BACKFILL_PAGE - 1);
      if (error) { console.error('[thumb-backfill.read]', table, error.message || error); break; }
      for (const row of data || []) if (thumbPathFor(row.profile_photo_path)) paths.add(row.profile_photo_path);
      if (!data || data.length < BACKFILL_PAGE) break;
    }
  }
  const sign = signUrls || (await import('@/lib/profile-photo')).createProfilePhotoSignedUrls;
  const all = [...paths];
  const existing = await sign(admin, all.map(thumbPathFor), 60, { quiet: true });
  const missing = all.filter((p) => !existing.has(thumbPathFor(p)));
  const made = await generateProfilePhotoThumbs(admin, missing, { limit, concurrency, deadline });
  return { photos: all.length, missing: missing.length, made };
}

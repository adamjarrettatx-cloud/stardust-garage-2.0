import { createProfilePhotoSignedUrl, createProfilePhotoSignedUrls } from '@/lib/profile-photo';

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
export async function resolveMemberPhotoUrls(admin, rows) {
  const map = new Map();
  if (!Array.isArray(rows) || rows.length === 0) return map;

  const valid = rows.filter((row) => row?.id);
  const paths = valid.map((row) => row.profile_photo_path).filter(Boolean);
  let signed = new Map();
  if (paths.length) {
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

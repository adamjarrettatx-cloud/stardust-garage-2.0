import { createProfilePhotoSignedUrl } from '@/lib/profile-photo';

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
      if (signed) return signed;
    } catch (err) {
      console.error('[member-photo.signed-url]', err?.message || err);
      // Fall through to the legacy column if signing fails so an outage of
      // the storage API does not blank every avatar on the admin page.
    }
  }

  return row.photo_url || null;
}

// Bulk version for lists. Runs signed-URL calls in parallel and returns a
// Map<row.id, displayUrl>. Signing failures for individual rows fall through
// to that row's photo_url so one bad path never blanks the whole page.
export async function resolveMemberPhotoUrls(admin, rows) {
  const map = new Map();
  if (!Array.isArray(rows) || rows.length === 0) return map;

  await Promise.all(
    rows.map(async (row) => {
      if (!row?.id) return;
      const url = await resolveMemberPhotoUrl(admin, row);
      map.set(row.id, url);
    }),
  );

  return map;
}

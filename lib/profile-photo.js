// Shared constants + helpers for the profile-photo system.
//
// Photos live in the PRIVATE Supabase Storage bucket `profile-photos`. Reads
// happen only via short-lived signed URLs. Do NOT expose raw storage paths to
// the client — they're only useful to the server (with the service role) and
// leaking them would let anyone with a URL enumerate stored biometric data.
//
// Layout: `<user_id>/photo.<ext>` — one photo per user, replaced on re-upload.
// Storage RLS also keys ownership off the first path segment as a defense in
// depth even though writes go through the service-role admin client today.

export const PROFILE_PHOTO_BUCKET = 'profile-photos';

export const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

// Kept in lockstep with the storage bucket's `allowed_mime_types`
// (see migrations/20260907_profile_photos.sql). If you widen one, widen both.
export const ALLOWED_PROFILE_PHOTO_MIME = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

// How long a signed URL is valid. Deliberately short — door-scanner UI
// re-mints on every scan, and the wallet/account UI polls on load.
export const PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS = 5 * 60; // 5 min

const MIME_TO_EXT = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
});

export function extForMime(mime) {
  return MIME_TO_EXT[mime] || 'jpg';
}

// Stable per-user path. Same user + same extension = replace-in-place.
// Any prior extension is cleaned up by the upload endpoint before writing.
export function profilePhotoStoragePath(userId, ext) {
  if (!userId) throw new Error('profilePhotoStoragePath: userId is required');
  const safeExt = String(ext || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return `${userId}/photo.${safeExt}`;
}

// Mint a signed URL for a stored photo. Returns { signedUrl, expiresAt } or
// null on failure so callers can render a placeholder instead of exploding.
//
// The admin client must be a service-role client — RLS on the private bucket
// blocks anonymous or user-scoped clients from generating signed URLs for
// arbitrary paths, and door-scanner staff need to view the ticket-owner
// photo without being authenticated as that user.
export async function createProfilePhotoSignedUrl(adminClient, path, ttlSeconds = PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS) {
  if (!adminClient || !path) return null;
  try {
    const { data, error } = await adminClient
      .storage
      .from(PROFILE_PHOTO_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    if (error || !data?.signedUrl) return null;
    return {
      signedUrl: data.signedUrl,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

// The partner profile photo — picking one, checking it, and getting it into
// storage. Shared by /portal/activate (where it is mandatory before the
// account switches on) and /portal/profile (where it can be replaced later),
// so the two screens cannot drift on what counts as an acceptable image.
//
// Legacy partner photos stay in their own private bucket. Each object is
// namespaced by the signed-in uploader so Storage RLS can prove ownership.
//
// Client-side module. The caller passes in a browser Supabase client; nothing
// here reaches for a service-role key. The returned object path is re-validated
// server-side against the caller namespace before it is stored — see
// /api/portal/profile.

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_BUCKET = 'member-photos';

// Returns a message to show the partner, or null when the file is fine.
export function validatePhotoFile(file) {
  if (!file) return 'Please choose a photo.';
  if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) return 'Please choose a JPG, PNG or WebP image.';
  if (file.size > MAX_PHOTO_BYTES) return 'That photo is over 5MB. Please choose a smaller file.';
  return null;
}

// The first path segment is always the authenticated user's UUID. The filename
// remains tame and non-user-controlled enough for a strict Storage RLS policy.
export function partnerPhotoFilename(originalName, userId, now = Date.now(), random = Math.random()) {
  const name = typeof originalName === 'string' ? originalName : '';
  const ext = name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'jpg';
  const sanitized =
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .slice(0, 40)
      // A name that was all punctuation collapses to dashes, which is not a
      // fallback — trim them off so it reaches the 'photo' default below.
      .replace(/^-+|-+$/g, '') || 'photo';
  if (typeof userId !== 'string' || !userId) return null;
  return `${userId}/partner-${now}-${random.toString(36).slice(2, 8)}-${sanitized}.${ext}`;
}

// Uploads and returns { path, error }. Persisting the object path (not a
// public URL) keeps reads behind authenticated Storage policies.
export async function uploadPartnerPhoto(supabase, file) {
  const invalid = validatePhotoFile(file);
  if (invalid) return { path: null, error: invalid };

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (authError || !userId) return { path: null, error: 'Please sign in again before uploading a photo.' };

  const filename = partnerPhotoFilename(file.name, userId);
  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(filename, file, { contentType: file.type });

  if (uploadError) {
    console.error('[partner-photo] upload failed', uploadError);
    return { path: null, error: 'Could not upload your photo. Please try again.' };
  }

  return { path: filename, error: null };
}

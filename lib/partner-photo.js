// The partner profile photo — picking one, checking it, and getting it into
// storage. Shared by /portal/activate (where it is mandatory before the
// account switches on) and /portal/profile (where it can be replaced later),
// so the two screens cannot drift on what counts as an acceptable image.
//
// Same limits and same public bucket as the membership application photo in
// ApplyForm.js: one place for "a face our door staff can match against".
//
// Client-side module. The caller passes in a browser Supabase client; nothing
// here reaches for a service-role key. The URL this produces is re-validated
// server-side against the bucket prefix before it is stored — see
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

// Bucket keys are flat and public, so the name has to be unguessable enough not
// to collide and tame enough to survive a URL. The original name is kept as a
// readable suffix purely so the bucket is browsable by a human.
export function partnerPhotoFilename(originalName, now = Date.now(), random = Math.random()) {
  const name = typeof originalName === 'string' ? originalName : '';
  const ext = name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const sanitized =
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .slice(0, 40)
      // A name that was all punctuation collapses to dashes, which is not a
      // fallback — trim them off so it reaches the 'photo' default below.
      .replace(/^-+|-+$/g, '') || 'photo';
  return `partner-${now}-${random.toString(36).slice(2, 8)}-${sanitized}.${ext}`;
}

// Uploads and returns { url, error }. `error` is already phrased for the
// partner; callers show it verbatim.
export async function uploadPartnerPhoto(supabase, file) {
  const invalid = validatePhotoFile(file);
  if (invalid) return { url: null, error: invalid };

  const filename = partnerPhotoFilename(file.name);
  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(filename, file, { contentType: file.type });

  if (uploadError) {
    console.error('[partner-photo] upload failed', uploadError);
    return { url: null, error: 'Could not upload your photo. Please try again.' };
  }

  const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(filename);
  if (!data?.publicUrl) {
    return { url: null, error: 'Could not upload your photo. Please try again.' };
  }
  return { url: data.publicUrl, error: null };
}

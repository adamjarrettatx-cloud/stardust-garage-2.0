import { createProfilePhotoSignedUrl } from '@/lib/profile-photo';

// buildTrialPassPreview(admin, pass)
//
// Returns the door-scanner preview payload for a trial-pass row: the guest's
// first name, whether a photo is on file, and a short-lived signed URL to
// their face photo out of the private profile-photos bucket.
//
// Never leaks the raw storage path — the door tablet only receives a URL it
// can render. If no path is on file, `hasPhoto` is false and the operator
// should treat this as a soft rejection reason ("no_photo_on_file") unless
// they can verify ID.

export async function buildTrialPassPreview(admin, pass) {
  const firstName = String(pass?.full_name || '').split(' ')[0] || null;

  const fallback = {
    firstName,
    hasPhoto: false,
    photoSignedUrl: null,
  };

  if (!admin || !pass?.profile_photo_path) return fallback;

  try {
    const signedUrl = await createProfilePhotoSignedUrl(admin, pass.profile_photo_path);
    return {
      firstName,
      hasPhoto: Boolean(signedUrl),
      photoSignedUrl: signedUrl || null,
    };
  } catch (err) {
    console.error('[trial-pass-preview.signed-url]', err?.message || err);
    return fallback;
  }
}

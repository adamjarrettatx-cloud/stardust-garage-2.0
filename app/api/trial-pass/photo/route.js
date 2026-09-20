import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { hashPassToken, isWellFormedPassToken, isPassLive } from '@/lib/trial-pass';
import {
  PROFILE_PHOTO_BUCKET,
  MAX_PROFILE_PHOTO_BYTES,
  ALLOWED_PROFILE_PHOTO_MIME,
  extForMime,
  createProfilePhotoSignedUrl,
} from '@/lib/profile-photo';

// Statuses that mean "the guest still legitimately owns this pass and might
// reasonably want to add/replace a photo". Unactivated passes ('active' with
// activated_at=null) count: the whole point of asking for a photo up front is
// so it's on file BEFORE the guest walks in and activates.
const PHOTO_UPLOAD_ELIGIBLE_STATUSES = new Set([
  'pending',
  'issued',
  'active',
  'applied',
  'converted',
]);

// POST /api/trial-pass/photo
// Body: multipart form-data with:
//   - `photo` (image file)
//   - `token` (the trial-pass token — the same one in the pass URL)
//
// Auth: the token IS the credential (same model as the /pass/[token] page).
// A guest with the token can upload / replace their pass photo. We never
// return the token or the storage path — only the signed URL, so a leak in
// the response body can't be used to enumerate other passes.
//
// This is intentionally NOT wired into the Twilio verify flow. Photo upload
// happens as a follow-up step on the pass page (or the intake success
// screen). If the guest closes the tab without uploading, they'll get
// bounced at the door by the scanner UI's "no photo on file" reject reason.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Storage layout: trial-pass/<trial_pass_id>/photo.<ext>
function trialPassStoragePath(trialPassId, ext) {
  if (!trialPassId) throw new Error('trialPassStoragePath: trialPassId is required');
  const safeExt = String(ext || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return `trial-pass/${trialPassId}/photo.${safeExt}`;
}

export async function POST(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Storage is not configured.' }, { status: 503 });
  }

  let form;
  try { form = await request.formData(); }
  catch { return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 }); }

  const token = typeof form.get('token') === 'string' ? form.get('token').trim() : '';
  const file = form.get('photo');

  if (!isWellFormedPassToken(token)) {
    // Same 404-ish shape as /pass/[token] — a bad token is unknown, not a
    // reason to leak that "some passes exist".
    return NextResponse.json({ error: 'Invalid pass link.' }, { status: 400 });
  }
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Missing `photo` file.' }, { status: 400 });
  }
  if (!ALLOWED_PROFILE_PHOTO_MIME.includes(file.type)) {
    return NextResponse.json(
      { error: `Unsupported image type "${file.type}". Use JPEG, PNG, WebP, or HEIC.` },
      { status: 415 },
    );
  }
  if (file.size > MAX_PROFILE_PHOTO_BYTES) {
    return NextResponse.json(
      { error: `Photo is over ${Math.round(MAX_PROFILE_PHOTO_BYTES / 1024 / 1024)} MB. Please choose a smaller file.` },
      { status: 413 },
    );
  }
  if (file.size < 1024) {
    return NextResponse.json({ error: 'Photo appears empty. Please try again.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const tokenHash = hashPassToken(token);
  const { data: pass, error: readError } = await admin
    .from('trial_passes')
    .select('id, status, activated_at, expires_at, extended_until, signup_expires_at, profile_photo_path')
    .eq('qr_token_hash', tokenHash)
    .maybeSingle();
  if (readError || !pass) {
    // Same shape as bad token — don't leak whether the token is valid but
    // the pass row is missing versus vice versa.
    return NextResponse.json({ error: 'Invalid pass link.' }, { status: 400 });
  }

  // Reject expired or revoked passes so we don't waste a storage write on a
  // pass the guest can't use anyway. A pass is eligible for photo upload if:
  //   1. Its status is in PHOTO_UPLOAD_ELIGIBLE_STATUSES (not 'expired' /
  //      'revoked' / anything terminal), AND
  //   2. Either it hasn't been activated yet (still inside the sign-up
  //      window — expires_at is null until first door scan), OR the live
  //      30-day activation window is still open.
  //
  // Historical bug: this used to call isPassLive() which returns false when
  // expires_at is null, silently rejecting every unactivated pass with
  // "This pass is no longer active." — the exact state every guest is in
  // when they first receive the QR and try to add their photo.
  const statusEligible = PHOTO_UPLOAD_ELIGIBLE_STATUSES.has(pass.status);
  const activated = Boolean(pass.activated_at);
  const stillLive = isPassLive(pass);
  const signupWindowOpen = !activated;
  if (!statusEligible || (!stillLive && !signupWindowOpen)) {
    return NextResponse.json({ error: 'This pass is no longer active.' }, { status: 410 });
  }

  const ext = extForMime(file.type);
  const path = trialPassStoragePath(pass.id, ext);

  // Best-effort cleanup of any prior extension so orphans don't accumulate.
  try {
    const { data: existing } = await admin.storage
      .from(PROFILE_PHOTO_BUCKET)
      .list(`trial-pass/${pass.id}`, { limit: 20 });
    if (existing && existing.length) {
      const stale = existing
        .filter((entry) => entry?.name && `trial-pass/${pass.id}/${entry.name}` !== path)
        .map((entry) => `trial-pass/${pass.id}/${entry.name}`);
      if (stale.length) await admin.storage.from(PROFILE_PHOTO_BUCKET).remove(stale);
    }
  } catch { /* noop */ }

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from(PROFILE_PHOTO_BUCKET)
    .upload(path, Buffer.from(arrayBuffer), {
      contentType: file.type,
      upsert: true,
      cacheControl: '3600',
    });
  if (uploadError) {
    return NextResponse.json(
      { error: 'Could not save your photo. Please try again.', detail: uploadError.message },
      { status: 500 },
    );
  }

  const nowIso = new Date().toISOString();
  const { error: dbError } = await admin
    .from('trial_passes')
    .update({
      profile_photo_path: path,
      profile_photo_uploaded_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', pass.id);
  if (dbError) {
    return NextResponse.json(
      { error: 'Photo uploaded but pass could not be updated.', detail: dbError.message },
      { status: 500 },
    );
  }

  const signed = await createProfilePhotoSignedUrl(admin, path);
  return NextResponse.json({
    ok: true,
    uploadedAt: nowIso,
    signedUrl: signed?.signedUrl || null,
  });
}

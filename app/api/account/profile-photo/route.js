import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import {
  PROFILE_PHOTO_BUCKET,
  MAX_PROFILE_PHOTO_BYTES,
  ALLOWED_PROFILE_PHOTO_MIME,
  extForMime,
  profilePhotoStoragePath,
  createProfilePhotoSignedUrl,
} from '@/lib/profile-photo';

// User-authenticated profile-photo endpoint.
//
// Storage layout: <user_id>/photo.<ext> in the PRIVATE `profile-photos`
// bucket. Reads always go through short-lived signed URLs — never expose
// the raw path publicly, this is personal biometric data used for door
// check-in verification.
//
// Kept intentionally simple: one photo per user, replacing on re-upload.
// Uses the service-role admin client for storage writes because the bucket
// is private and we want to enforce validation server-side (mime, size,
// path shape) rather than relying purely on Storage RLS.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST — upload / replace the caller's profile photo. Multipart form-data
// with a single `photo` file field.
export async function POST(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Storage is not configured.' }, { status: 503 });
  }

  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data.' }, { status: 400 });
  }

  const file = form.get('photo');
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
    // Below-1KB uploads are almost always errors (empty file, browser bug).
    return NextResponse.json({ error: 'Photo appears empty. Please try again.' }, { status: 400 });
  }

  const ext = extForMime(file.type);
  const path = profilePhotoStoragePath(user.id, ext);
  const admin = createAdminClient();

  // Best-effort cleanup of any previously uploaded file with a different
  // extension. Silently ignore failures — the new upload with `upsert: true`
  // will replace-in-place if the extension matches, and any orphan with the
  // old extension is invisible to the app (only the DB path is authoritative).
  try {
    const { data: existing } = await admin.storage.from(PROFILE_PHOTO_BUCKET).list(user.id, { limit: 20 });
    if (existing && existing.length) {
      const stale = existing
        .filter((entry) => entry?.name && `${user.id}/${entry.name}` !== path)
        .map((entry) => `${user.id}/${entry.name}`);
      if (stale.length) {
        await admin.storage.from(PROFILE_PHOTO_BUCKET).remove(stale);
      }
    }
  } catch { /* noop — replacement upload below is the important part */ }

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

  // Upsert the free_accounts row. On first ticket purchase / trial-pass
  // intake we may not have created the row yet, so INSERT ... ON CONFLICT
  // keyed by user_id.
  const nowIso = new Date().toISOString();
  const { error: dbError } = await admin
    .from('free_accounts')
    .upsert(
      {
        user_id: user.id,
        email: user.email || null,
        profile_photo_path: path,
        profile_photo_uploaded_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'user_id' },
    );
  if (dbError) {
    return NextResponse.json(
      { error: 'Photo uploaded but profile could not be updated.', detail: dbError.message },
      { status: 500 },
    );
  }

  // Return a signed URL so the caller can immediately display the new
  // photo without a second round trip.
  const signed = await createProfilePhotoSignedUrl(admin, path);
  return NextResponse.json({
    ok: true,
    uploadedAt: nowIso,
    signedUrl: signed?.signedUrl || null,
    signedUrlExpiresAt: signed?.expiresAt || null,
  });
}

// GET — fetch a signed URL for the caller's own current profile photo.
// Used by client components (avatar, wallet nudge) that need to render the
// existing photo. Door-scanner UI does NOT call this — staff use
// /api/tickets/scan which returns the signed URL for the ticket-owner
// photo directly.
export async function GET(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ signedUrl: null, uploadedAt: null });
  }
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('free_accounts')
    .select('profile_photo_path, profile_photo_uploaded_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!row?.profile_photo_path) {
    return NextResponse.json({ signedUrl: null, uploadedAt: null });
  }
  const signed = await createProfilePhotoSignedUrl(admin, row.profile_photo_path);
  return NextResponse.json({
    signedUrl: signed?.signedUrl || null,
    signedUrlExpiresAt: signed?.expiresAt || null,
    uploadedAt: row.profile_photo_uploaded_at,
  });
}

// DELETE — remove the caller's profile photo (storage + DB pointer).
// Used by the "remove photo" affordance in the account UI.
export async function DELETE(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Storage is not configured.' }, { status: 503 });
  }
  const user = await getRequestUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('free_accounts')
    .select('profile_photo_path')
    .eq('user_id', user.id)
    .maybeSingle();
  if (row?.profile_photo_path) {
    try { await admin.storage.from(PROFILE_PHOTO_BUCKET).remove([row.profile_photo_path]); }
    catch { /* ignore — DB unlink below is what matters */ }
  }
  await admin
    .from('free_accounts')
    .update({
      profile_photo_path: null,
      profile_photo_uploaded_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);
  return NextResponse.json({ ok: true });
}

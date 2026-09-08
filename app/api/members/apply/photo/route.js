import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { rateLimit, keyFromRequest } from '@/lib/rate-limit';
import {
  PROFILE_PHOTO_BUCKET,
  MAX_PROFILE_PHOTO_BYTES,
  ALLOWED_PROFILE_PHOTO_MIME,
  extForMime,
  createProfilePhotoSignedUrl,
} from '@/lib/profile-photo';

// POST /api/members/apply/photo
// Body: multipart form-data with:
//   - `photo` (image file)
//
// Public, unauthenticated. Applicants haven't created an account yet, so
// there's no bearer token to check. Rate-limited by IP to stop misuse.
//
// Returns `{ photoPath, signedUrl, uploadedAt }`. The client then submits
// the application form with `photoPath` in the payload, and the /apply
// server action stores it on the application row.
//
// Storage layout: profile-photos/member-app/<uuid>/photo.<ext>
// The <uuid> is server-generated and returned to the client so the client
// cannot forge collisions with other applications.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT_PER_HOUR = 20; // per-IP, per-instance

function memberAppStoragePath(applicationTempId, ext) {
  if (!applicationTempId) {
    throw new Error('memberAppStoragePath: applicationTempId is required');
  }
  const safeExt = String(ext || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return `member-app/${applicationTempId}/photo.${safeExt}`;
}

export async function POST(request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Storage is not configured.' }, { status: 503 });
  }

  const rl = rateLimit({
    key: keyFromRequest(request, 'members-apply-photo'),
    limit: RATE_LIMIT_PER_HOUR,
    windowMs: 60 * 60 * 1000,
  });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many uploads from your network. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
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
    return NextResponse.json({ error: 'Photo appears empty. Please try again.' }, { status: 400 });
  }

  const applicationTempId = randomUUID();
  const ext = extForMime(file.type);
  const path = memberAppStoragePath(applicationTempId, ext);

  const admin = createAdminClient();
  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from(PROFILE_PHOTO_BUCKET)
    .upload(path, Buffer.from(arrayBuffer), {
      contentType: file.type,
      upsert: false,
      cacheControl: '3600',
    });
  if (uploadError) {
    return NextResponse.json(
      { error: 'Could not save your photo. Please try again.', detail: uploadError.message },
      { status: 500 },
    );
  }

  const signed = await createProfilePhotoSignedUrl(admin, path);
  return NextResponse.json({
    ok: true,
    photoPath: path,
    uploadedAt: new Date().toISOString(),
    signedUrl: signed?.signedUrl || null,
  });
}

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  GUEST_SIGNATURE_BUCKET,
  SIGNATURE_URL_TTL_SECONDS,
  isGuestSignaturePath,
} from '@/lib/guest-signature';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/admin/guest-signature/:guestProfileId
//
// Opens the consent signature a guest drew at the door. The bucket is private,
// so this gates on admin, looks the path up server-side, mints a signed URL
// that dies in a minute and redirects to it — the storage path itself is never
// exposed, and a link copied out of browser history is useless by the time
// anyone else finds it.
export async function GET(request, { params }) {
  const { unauthorized } = await requireAdmin();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { profileId } = await params;
  if (!UUID.test(profileId)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('guest_profiles')
    .select('id, signature_path')
    .eq('id', profileId)
    .maybeSingle();

  // isGuestSignaturePath is the backstop: a column value that does not match
  // this bucket's `<uuid>/<uuid>.png` layout is never handed to storage.
  if (!profile || !isGuestSignaturePath(profile.signature_path)) {
    return NextResponse.json({ error: 'No signature on file' }, { status: 404 });
  }

  const { data, error } = await admin.storage
    .from(GUEST_SIGNATURE_BUCKET)
    .createSignedUrl(profile.signature_path, SIGNATURE_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    console.error('[admin.guest-signature]', error);
    return NextResponse.json({ error: 'Storage error' }, { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer' },
  });
}

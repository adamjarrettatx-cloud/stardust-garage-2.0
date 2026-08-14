import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/manual-income';
import { SPOTON_IMPORT_BUCKET } from '@/lib/spoton-import';

export const runtime = 'nodejs';

// Step 0 of the SpotOn CSV import, for files too large to ride along in a
// single serverless-function request body.
//
// Vercel caps the body of a request TO a serverless function at ~4.5MB,
// enforced at the platform/proxy layer before our route code ever runs — our
// own MAX_CSV_BYTES check in the main spoton-import route never even gets a
// chance to reject or accept anything for a file over that size; the request
// just fails with a bare network error.
//
// The fix: the browser never sends the CSV bytes to this Next.js app at all.
// It uploads directly to Supabase Storage using a short-lived signed upload
// URL minted here, then hands the resulting storage path to the main
// spoton-import POST route, which downloads the bytes itself (a
// server-to-Supabase fetch, not a client request body, so it isn't subject to
// the platform limit) and deletes the temp object once parsed.
export async function POST(request) {
  try {
    if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
      return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
    }
    const { user, unauthorized } = await requireOwner();
    if (unauthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const path = `${user.id}/${randomUUID()}.csv`;
    const supabase = createAdminClient();
    const { data, error } = await supabase.storage
      .from(SPOTON_IMPORT_BUCKET)
      .createSignedUploadUrl(path);
    if (error) throw new Error(error.message);

    return NextResponse.json({
      success: true,
      bucket: SPOTON_IMPORT_BUCKET,
      path: data.path,
      token: data.token,
    });
  } catch (err) {
    console.error('spoton-import upload-url error:', err);
    return NextResponse.json({ error: 'Server error: ' + (err?.message || 'unknown') }, { status: 500 });
  }
}

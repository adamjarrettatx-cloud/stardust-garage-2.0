import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { backfillProfilePhotoThumbs } from '@/lib/profile-photo-thumbs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET /api/cron/profile-photo-thumbs
//
// Every 5 minutes, 6 AM–6 PM Central only (time-budgeted to ~45s per run). Builds the small list-size copy for profile
// photos that don't have one yet (see lib/profile-photo-thumbs.js). Reads
// originals and writes only `_thumbs/…` objects; never touches originals or
// database rows.
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 500 });
  }
  try {
    const result = await backfillProfilePhotoThumbs(createAdminClient());
    // Progress line for the Vercel logs: photos total / still missing / built.
    console.log('[cron.profile-photo-thumbs]', JSON.stringify(result));
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron.profile-photo-thumbs]', err?.message || err);
    return NextResponse.json({ error: 'Backfill failed' }, { status: 500 });
  }
}

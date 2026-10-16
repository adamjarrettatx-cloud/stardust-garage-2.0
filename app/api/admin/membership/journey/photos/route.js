// POST /api/admin/membership/journey/photos
//
// Signs profile photos for the Journey cards that are actually on screen.
// The list endpoint (/api/admin/membership/journey) returns only `has_photo`
// per row so the page renders immediately; the client then batches the keys
// of visible cards here.
//
// Body: { keys: ['account:<id>' | 'trial:<id>' | 'member:<id>', ...] }
// Response: { photos: { [key]: url | null }, ttl_seconds, expires_at }
//
// Security:
//   - Owner-gated, same as the list endpoint.
//   - The client sends row ids only. Storage paths are always read from the
//     database server-side; a client-supplied path is never signed.
//   - Raw storage paths are never returned.

import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveMemberPhotoUrls } from '@/lib/member-photo';
import { PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS } from '@/lib/profile-photo';
import { JOURNEY_PHOTO_SOURCES, MAX_PHOTO_KEYS, parsePhotoKeys } from '@/lib/journey-photos';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request) {
  const { unauthorized } = await requireOwner();
  if (unauthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const byKind = parsePhotoKeys(body?.keys);
  if (!byKind) {
    return NextResponse.json(
      { error: `keys must be an array of at most ${MAX_PHOTO_KEYS} row keys` },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const lookups = await Promise.all(
    Object.entries(byKind).map(async ([kind, ids]) => {
      if (ids.size === 0) return [];
      const { table, columns } = JOURNEY_PHOTO_SOURCES[kind];
      const { data, error } = await admin.from(table).select(columns).in('id', [...ids]);
      if (error) {
        console.error('[journey.photos.lookup]', table, error.message || error);
        return [];
      }
      return (data || []).map((row) => ({
        id: `${kind}:${row.id}`,
        profile_photo_path: row.profile_photo_path || null,
        photo_url: row.photo_url || null,
      }));
    }),
  );

  const rows = lookups.flat();
  const resolved = await resolveMemberPhotoUrls(admin, rows, { size: 'thumb' });

  // Every requested key gets an answer so the client never re-asks for a
  // row that simply has no photo.
  const photos = {};
  for (const [kind, ids] of Object.entries(byKind)) {
    for (const id of ids) photos[`${kind}:${id}`] = resolved.get(`${kind}:${id}`) || null;
  }

  return NextResponse.json({
    photos,
    ttl_seconds: PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS,
    expires_at: new Date(Date.now() + PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}

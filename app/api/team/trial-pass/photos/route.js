// POST /api/team/trial-pass/photos
//
// Small thumbnail links for the Trial Pass rows on screen in
// /team/trial-pass/analytics. Same audience as that page (requireTeam).
//
// Body: { ids: [trial_pass id, ...] } (at most 200)
// Response: { photos: { [id]: url | null } }
//
// Only ids travel from the browser; storage paths are read server-side and
// never returned.

import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveMemberPhotoUrls } from '@/lib/member-photo';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_IDS = 200;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export async function POST(request) {
  const { unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!Array.isArray(body?.ids)) return NextResponse.json({ error: 'ids must be an array' }, { status: 400 });
  const ids = [...new Set(body.ids.filter((id) => typeof id === 'string' && ID_PATTERN.test(id)))];
  if (ids.length > MAX_IDS) return NextResponse.json({ error: `At most ${MAX_IDS} ids` }, { status: 400 });

  const photos = Object.fromEntries(ids.map((id) => [id, null]));
  if (ids.length) {
    const admin = createAdminClient();
    const { data, error } = await admin.from('trial_passes').select('id, profile_photo_path').in('id', ids);
    if (error) {
      console.error('[trial-pass.photos]', error.message || error);
    } else {
      const resolved = await resolveMemberPhotoUrls(admin, data || [], { size: 'thumb' });
      for (const [id, url] of resolved) if (id in photos) photos[id] = url;
    }
  }
  return NextResponse.json({ photos }, { headers: { 'Cache-Control': 'private, no-store' } });
}

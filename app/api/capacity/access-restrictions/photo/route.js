import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireFrontDeskOrTeam } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { UUID, RESTRICTION_PHOTO_BUCKET, RESTRICTION_PHOTO_TYPES, MAX_RESTRICTION_PHOTO_BYTES, sniffImageType } from '@/lib/capacity/access-policy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const reply = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

// Adds or replaces the photo on a banned/restricted record. Personal staff
// logins only; shared stations are excluded here and by the station allowlist.
// Earlier photos stay in the private bucket as part of the audit trail.
export async function POST(request) {
  const gate = await requireFrontDeskOrTeam(request);
  if (gate.unauthorized) return reply({ error: 'Unauthorized' }, 401);
  if (gate.station) return reply({ error: 'This station cannot change restriction photos.' }, 403);
  let form;
  try { form = await request.formData(); } catch { return reply({ error: 'Upload a photo.' }, 400); }
  const id = String(form.get('id') || '');
  const file = form.get('photo');
  if (!UUID.test(id)) return reply({ error: 'Choose a restriction.' }, 400);
  if (!file || typeof file.arrayBuffer !== 'function') return reply({ error: 'Upload a photo.' }, 400);
  if (file.size > MAX_RESTRICTION_PHOTO_BYTES) return reply({ error: 'Photo must be 10 MB or smaller.' }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type || !bytes.length) return reply({ error: 'Use a JPG, PNG or WebP photo.' }, 400);
  const admin = createAdminClient();
  const path = `${id}/${randomUUID()}.${RESTRICTION_PHOTO_TYPES[type]}`;
  const { error: uploadError } = await admin.storage.from(RESTRICTION_PHOTO_BUCKET)
    .upload(path, bytes, { contentType: type, upsert: false });
  if (uploadError) return reply({ error: 'Photo could not be uploaded. Try again.' }, 503);
  const { error } = await admin.rpc('update_access_restriction', {
    p_actor: gate.user.id, p_data: { id, photo_path: path, comment: typeof form.get('comment') === 'string' ? String(form.get('comment')).slice(0, 1800) : '' },
  });
  if (error) {
    await admin.storage.from(RESTRICTION_PHOTO_BUCKET).remove([path]).catch(() => {});
    if (error.code === '42501') return reply({ error: 'Only staff accounts can change restriction photos.' }, 403);
    return reply({ error: /no longer active|not found/i.test(error.message || '') ? error.message : 'Photo could not be saved. Try again.' }, 409);
  }
  return reply({ ok: true, id });
}

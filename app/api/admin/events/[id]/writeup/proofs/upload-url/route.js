import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/manual-income';
import { PROOF_BUCKET, PROOF_MAX_BYTES, PROOF_MAX_COUNT, PROOF_MIME } from '@/lib/event-writeup';
import { loadProofRows } from '@/lib/event-writeup-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;

// Step 1 of a POS screenshot upload. The image goes browser -> private
// Storage directly (Vercel caps function request bodies at ~4.5MB), then the
// proofs POST route verifies the stored object and records it.
export async function POST(request, { params }) {
  if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  }
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }
  const ext = PROOF_MIME[body?.content_type];
  if (!ext) return NextResponse.json({ error: 'Upload a PNG, JPG, WEBP or HEIC image.' }, { status: 400 });
  const size = Number(body?.size);
  if (!Number.isFinite(size) || size <= 0 || size > PROOF_MAX_BYTES) {
    return NextResponse.json({ error: 'Images must be 15 MB or smaller.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: event } = await admin.from('events').select('id').eq('id', id).maybeSingle();
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  const existing = await loadProofRows(admin, id);
  if (existing.length >= PROOF_MAX_COUNT) return NextResponse.json({ error: `Up to ${PROOF_MAX_COUNT} screenshots per event.` }, { status: 409 });

  const path = `${id}/${randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from(PROOF_BUCKET).createSignedUploadUrl(path);
  if (error) { console.error('[event.writeup.proof.url]', error); return NextResponse.json({ error: 'Could not start upload' }, { status: 500 }); }
  return NextResponse.json({ ok: true, bucket: PROOF_BUCKET, path: data.path, token: data.token });
}

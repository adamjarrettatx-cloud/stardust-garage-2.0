import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/manual-income';
import { PROOF_BUCKET, PROOF_MAX_BYTES, PROOF_MAX_COUNT, PROOF_MIME } from '@/lib/event-writeup';
import { loadEventWriteup, loadProofRows } from '@/lib/event-writeup-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;

// Step 2: record an uploaded POS screenshot after verifying the object really
// exists in this event's folder with an allowed type and size.
export async function POST(request, { params }) {
  if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  }
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }
  const path = String(body?.path || '');
  const m = path.match(/^([0-9a-f-]{36})\/([0-9a-f-]{36}\.(png|jpg|webp|heic|heif))$/i);
  if (!m || m[1].toLowerCase() !== id.toLowerCase()) return NextResponse.json({ error: 'Bad upload path' }, { status: 400 });
  const name = String(body?.name || 'POS screenshot').trim().slice(0, 120) || 'POS screenshot';

  const admin = createAdminClient();
  const { data: listed, error: listErr } = await admin.storage.from(PROOF_BUCKET).list(id, { search: m[2], limit: 5 });
  if (listErr) { console.error('[event.writeup.proof.verify]', listErr); return NextResponse.json({ error: 'Could not verify upload' }, { status: 500 }); }
  const obj = (listed || []).find((o) => o.name === m[2]);
  const mime = obj?.metadata?.mimetype;
  const size = Number(obj?.metadata?.size);
  if (!obj || !PROOF_MIME[mime] || !(size > 0 && size <= PROOF_MAX_BYTES)) {
    if (obj) await admin.storage.from(PROOF_BUCKET).remove([path]);
    return NextResponse.json({ error: 'Upload was not a valid image.' }, { status: 400 });
  }

  const existing = await loadProofRows(admin, id);
  if (existing.some((p) => p.path === path)) {
    const result = await loadEventWriteup(admin, id);
    return NextResponse.json({ ok: true, ...result });
  }
  if (existing.length >= PROOF_MAX_COUNT) {
    await admin.storage.from(PROOF_BUCKET).remove([path]);
    return NextResponse.json({ error: `Up to ${PROOF_MAX_COUNT} screenshots per event.` }, { status: 409 });
  }

  const proof = { id: randomUUID(), path, name, content_type: mime, size, uploaded_at: new Date().toISOString(), uploaded_by: user.id };
  const { error: upErr } = await admin
    .from('event_writeups')
    .upsert({ event_id: id, created_by: user.id }, { onConflict: 'event_id', ignoreDuplicates: true });
  if (upErr) { console.error('[event.writeup.proof.ensure]', upErr); return NextResponse.json({ error: 'Save failed' }, { status: 500 }); }
  const { error } = await admin
    .from('event_writeups')
    .update({ door_proofs: [...existing, proof], updated_by: user.id, updated_at: new Date().toISOString() })
    .eq('event_id', id);
  if (error) { console.error('[event.writeup.proof.save]', error); return NextResponse.json({ error: 'Save failed' }, { status: 500 }); }

  const result = await loadEventWriteup(admin, id);
  return NextResponse.json({ ok: true, ...result });
}

import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSameOrigin } from '@/lib/manual-income';
import { PROOF_BUCKET } from '@/lib/event-writeup';
import { loadEventWriteup, loadProofRows } from '@/lib/event-writeup-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f-]{36}$/i;
const NO_STORE = { 'Cache-Control': 'private, no-store' };

// GET — open the screenshot through a 60-second signed link.
export async function GET(request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401, headers: NO_STORE });
  const { id, proofId } = await params;
  if (!UUID.test(id) || !UUID.test(proofId)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  const admin = createAdminClient();
  const proof = (await loadProofRows(admin, id)).find((p) => p.id === proofId);
  if (!proof) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
  const { data, error } = await admin.storage.from(PROOF_BUCKET).createSignedUrl(proof.path, 60);
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'Unavailable' }, { status: 503, headers: NO_STORE });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: NO_STORE });
}

// DELETE — remove the screenshot from the record and from storage.
export async function DELETE(request, { params }) {
  if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 });
  }
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id, proofId } = await params;
  if (!UUID.test(id) || !UUID.test(proofId)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const admin = createAdminClient();
  const rows = await loadProofRows(admin, id);
  const proof = rows.find((p) => p.id === proofId);
  if (!proof) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await admin
    .from('event_writeups')
    .update({ door_proofs: rows.filter((p) => p.id !== proofId), updated_by: user.id, updated_at: new Date().toISOString() })
    .eq('event_id', id);
  if (error) { console.error('[event.writeup.proof.delete]', error); return NextResponse.json({ error: 'Delete failed' }, { status: 500 }); }
  const { error: rmErr } = await admin.storage.from(PROOF_BUCKET).remove([proof.path]);
  if (rmErr) console.error('[event.writeup.proof.remove]', rmErr);
  const result = await loadEventWriteup(admin, id);
  return NextResponse.json({ ok: true, ...result });
}

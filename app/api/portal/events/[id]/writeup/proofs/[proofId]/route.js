import { NextResponse } from 'next/server';
import { requirePartner, createRequestScopedClient } from '@/lib/auth-helpers';
import { partnerCanViewEvents } from '@/lib/profile-capabilities';
import { createAdminClient } from '@/lib/supabase/admin';
import { PROOF_BUCKET } from '@/lib/event-writeup';
import { loadProofRows } from '@/lib/event-writeup-data';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });

// Organizer "View POS proof". Access is decided by the database as the
// signed-in partner (partner_event_writeup: event organizer only, shared
// write-ups only). Only then does the server mint a 60-second signed link.
export async function GET(request, { params }) {
  const { unauthorized, partner } = await requirePartner(request);
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
  if (!partnerCanViewEvents(partner)) return notFound();
  const { id, proofId } = await params;
  if (!UUID.test(id) || !UUID.test(proofId)) return notFound();

  const db = await createRequestScopedClient(request);
  const { data: view, error } = await db.rpc('partner_event_writeup', { p_event_id: id });
  if (error || !view?.shared) return notFound();
  if (!(view.proofs || []).some((p) => p.id === proofId)) return notFound();

  const admin = createAdminClient();
  const proof = (await loadProofRows(admin, id)).find((p) => p.id === proofId);
  if (!proof) return notFound();
  const { data, error: signErr } = await admin.storage.from(PROOF_BUCKET).createSignedUrl(proof.path, 60);
  if (signErr || !data?.signedUrl) return NextResponse.json({ error: 'Unavailable' }, { status: 503, headers: NO_STORE });
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: NO_STORE });
}

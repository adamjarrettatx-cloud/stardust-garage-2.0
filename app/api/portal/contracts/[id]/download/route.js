import { NextResponse } from 'next/server';
import { requirePartner } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient, streamDocumentVersion, audit } from '@/lib/document-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/portal/contracts/:contractId/download
//
// The counterparty's own copy of a FULLY SIGNED agreement. There is no public or
// guest path to any contract; this route is reachable only with an active partner
// session, and it proves ownership before touching storage.
//
// THREE INDEPENDENT GATES, all server-side:
//   1. requirePartner()  — an active partner_profiles row, i.e. a real login.
//   2. partner_contracts() — the same SECURITY DEFINER RPC the portal page uses,
//      scoped by partner_contact_id(). The requested contract must appear in the
//      caller's own list, so substituting another contract's id yields 404. This
//      reuses the existing authorization rather than re-deriving it here, so
//      there is one definition of "my contracts".
//   3. status === 'signed' — mid-signature the stored file is not the executed
//      document, so only the completed agreement is releasable.
//
// The id in the URL is the CONTRACT id, not the document id: a partner has no
// reason to learn internal document ids, and it keeps this route from ever
// resolving a non-contract document.
export async function GET(request, { params }) {
  const { user, unauthorized } = await requirePartner();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const supabase = await createClient();
  const { data: rows, error } = await supabase.rpc('partner_contracts');
  if (error) {
    console.error('[portal contract download] partner_contracts failed', error);
    return NextResponse.json({ error: 'Could not verify access.' }, { status: 500 });
  }

  const contract = (rows || []).find((r) => r.contract_id === id);
  // Deliberately 404, not 403: a partner should not be able to learn that a
  // contract id exists at all.
  if (!contract) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (contract.status !== 'signed') {
    return NextResponse.json(
      { error: 'That agreement isn\u2019t finalized yet, so there\u2019s no signed copy to open.' },
      { status: 409 },
    );
  }

  const admin = createAdminClient();

  // Record that the counterparty actually looked at it. This is a timestamp plus
  // an audit row, NOT a new status: `viewed` is not a state in the contract
  // lifecycle, so the forward-only status machine is untouched and a view can
  // never move a contract backwards.
  const nowIso = new Date().toISOString();
  await admin
    .from('document_contracts')
    .update({ viewed_at: nowIso })
    .eq('id', id)
    .is('viewed_at', null);

  await audit({
    admin,
    action: 'contract_viewed',
    documentId: contract.document_id,
    actorId: user.id,
    actorEmail: user.email,
    request,
    details: { contract_id: id, by: 'counterparty' },
  });

  return streamDocumentVersion({
    admin,
    documentId: contract.document_id,
    inline: true,
    actor: user,
    request,
  });
}

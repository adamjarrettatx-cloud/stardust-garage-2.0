import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient, audit } from '@/lib/document-helpers';
import {
  buildContractPatch,
  isValidContractStatus,
  canTransitionContract,
  isTerminalContractStatus,
} from '@/lib/contract-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// Ensure the parent document exists AND is in the 'contracts' category, since a
// contract record only makes sense for a contract document.
async function loadContractDocument(admin, documentId) {
  const { data: doc } = await admin
    .from('documents')
    .select('id, category')
    .eq('id', documentId)
    .maybeSingle();
  return doc;
}

// GET /api/admin/documents/:id/contract  -- read the contract record (if any)
export async function GET(request, { params }) {
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { data: contract } = await admin
    .from('document_contracts')
    .select('*')
    .eq('document_id', id)
    .maybeSingle();

  return NextResponse.json({ ok: true, contract: contract || null });
}

// PUT /api/admin/documents/:id/contract  -- create-or-update contract metadata.
// Does NOT change status (use POST for transitions). Creating a record for the
// first time emits a contract_create audit entry.
export async function PUT(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const built = buildContractPatch(body);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

  const admin = createAdminClient();

  const doc = await loadContractDocument(admin, id);
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (doc.category !== 'contracts') {
    return NextResponse.json({ error: 'Document is not in the contracts category' }, { status: 400 });
  }

  const { data: existing } = await admin
    .from('document_contracts')
    .select('id')
    .eq('document_id', id)
    .maybeSingle();

  if (existing) {
    if (Object.keys(built.patch).length) {
      const { error } = await admin
        .from('document_contracts')
        .update(built.patch)
        .eq('document_id', id);
      if (error) {
        console.error('[contract.update] error', error);
        return NextResponse.json({ error: 'Update failed' }, { status: 500 });
      }
    }
  } else {
    const { error } = await admin
      .from('document_contracts')
      .insert({ document_id: id, created_by: user.id, ...built.patch });
    if (error) {
      console.error('[contract.create] error', error);
      return NextResponse.json({ error: 'Create failed' }, { status: 500 });
    }
    await audit({
      admin, action: 'contract_create', documentId: id,
      actorId: user.id, actorEmail: user.email, request,
      details: { fields: Object.keys(built.patch) },
    });
  }

  const { data: contract } = await admin
    .from('document_contracts')
    .select('*')
    .eq('document_id', id)
    .maybeSingle();

  return NextResponse.json({ ok: true, contract });
}

// POST /api/admin/documents/:id/contract  -- status transition.
// Body: { status: '<next>' }. Enforces the forward-only state machine and
// stamps sent_at / completed_at where appropriate.
export async function POST(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const next = String(body.status || '').trim();
  if (!isValidContractStatus(next)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });

  const admin = createAdminClient();

  const doc = await loadContractDocument(admin, id);
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (doc.category !== 'contracts') {
    return NextResponse.json({ error: 'Document is not in the contracts category' }, { status: 400 });
  }

  const { data: contract } = await admin
    .from('document_contracts')
    .select('*')
    .eq('document_id', id)
    .maybeSingle();

  if (!contract) return NextResponse.json({ error: 'No contract record. Save details first.' }, { status: 404 });

  const from = contract.status;
  if (from === next) return NextResponse.json({ error: 'Status unchanged' }, { status: 400 });
  if (!canTransitionContract(from, next)) {
    return NextResponse.json({ error: `Cannot move from ${from} to ${next}` }, { status: 400 });
  }

  const patch = { status: next };
  if (next === 'sent' && !contract.sent_at) patch.sent_at = new Date().toISOString();
  if (isTerminalContractStatus(next) && !contract.completed_at) patch.completed_at = new Date().toISOString();

  const { error } = await admin
    .from('document_contracts')
    .update(patch)
    .eq('document_id', id);
  if (error) {
    console.error('[contract.transition] error', error);
    return NextResponse.json({ error: 'Transition failed' }, { status: 500 });
  }

  await audit({
    admin, action: 'contract_status_change', documentId: id,
    actorId: user.id, actorEmail: user.email, request,
    details: { from, to: next },
  });

  const { data: updated } = await admin
    .from('document_contracts')
    .select('*')
    .eq('document_id', id)
    .maybeSingle();

  return NextResponse.json({ ok: true, contract: updated });
}

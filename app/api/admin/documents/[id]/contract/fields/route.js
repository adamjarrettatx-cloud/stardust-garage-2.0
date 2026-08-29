import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient, audit } from '@/lib/document-helpers';
import { validateFieldLayout, sanitizeFieldValues } from '@/lib/contract-fields';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';
import { isContractLocked } from '@/lib/contract-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// PUT /api/admin/documents/:id/contract/fields
//   Body: { field_layout?, field_values? }
//   Saves the per-contract field layout (independently editable copy) and/or the
//   staff-entered business field values. Creates the contract record lazily if
//   it doesn't exist yet (mirrors the contract PUT route), so a one-off document
//   can gain fields without a template.
export async function PUT(request, { params }) {
  if (!isContractTemplatesEnabled()) {
    return NextResponse.json({ error: 'Not found', code: 'FEATURE_DISABLED' }, { status: 404 });
  }
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from('documents')
    .select('id, category')
    .eq('id', id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (doc.category !== 'contracts') {
    return NextResponse.json({ error: 'Document is not in the contracts category' }, { status: 400 });
  }

  const { data: existing } = await admin
    .from('document_contracts')
    .select('field_layout, status')
    .eq('document_id', id)
    .maybeSingle();

  // A signed agreement's fields ARE its terms. Once signatures exist, the layout
  // and the baked values are frozen; changing them would leave our record
  // describing a document nobody signed.
  if (existing && isContractLocked(existing.status)) {
    return NextResponse.json(
      {
        error: `This contract is ${existing.status}; its fields can no longer be changed. Create a new draft or replacement contract instead.`,
        code: 'CONTRACT_LOCKED',
      },
      { status: 409 },
    );
  }

  const patch = {};

  // Resolve the effective layout first — value sanitization is scoped to it.
  let effectiveLayout = Array.isArray(existing?.field_layout) ? existing.field_layout : [];
  if ('field_layout' in body) {
    const res = validateFieldLayout(body.field_layout);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    patch.field_layout = res.layout;
    effectiveLayout = res.layout;
  }
  if ('field_values' in body) {
    patch.field_values = sanitizeFieldValues(effectiveLayout, body.field_values);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  if (existing) {
    const { error } = await admin.from('document_contracts').update(patch).eq('document_id', id);
    if (error) {
      console.error('[contract.fields] update error', error);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
  } else {
    const { error } = await admin
      .from('document_contracts')
      .insert({ document_id: id, created_by: user.id, signature_provider: 'signnow', ...patch });
    if (error) {
      console.error('[contract.fields] insert error', error);
      return NextResponse.json({ error: 'Create failed' }, { status: 500 });
    }
  }

  await audit({
    admin, action: 'contract_fields_update', documentId: id,
    actorId: user.id, actorEmail: user.email, request,
    details: {
      field_count: patch.field_layout?.length,
      values_saved: 'field_values' in patch,
      // Value KEYS only. Field values can contain counterparty terms and personal
      // details, and the audit log is read by more people than the contract is.
      value_keys: 'field_values' in patch ? Object.keys(patch.field_values || {}) : undefined,
    },
  });

  const { data: contract } = await admin
    .from('document_contracts')
    .select('*')
    .eq('document_id', id)
    .maybeSingle();

  return NextResponse.json({ ok: true, contract });
}

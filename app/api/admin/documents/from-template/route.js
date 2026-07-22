import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import {
  createAdminClient,
  audit,
  buildStoragePath,
  sha256,
  DOCUMENT_BUCKET,
} from '@/lib/document-helpers';
import { validateFieldLayout } from '@/lib/contract-fields';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/admin/documents/from-template
//   Body: { template_id, title?, counterparty?, event_id? }
//   Clones a template's PDF into a NEW contract-category document (as its first
//   version) and creates a document_contracts row whose field_layout is a COPY
//   of the template's layout (independently editable per Adam's requirement that
//   the recipient-fillable field set varies per send). Returns { document_id }.
export async function POST(request) {
  if (!isContractTemplatesEnabled()) {
    return NextResponse.json({ error: 'Not found', code: 'FEATURE_DISABLED' }, { status: 404 });
  }
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const templateId = String(body.template_id || '').trim();
  if (!UUID.test(templateId)) return NextResponse.json({ error: 'Valid template_id is required' }, { status: 400 });

  const admin = createAdminClient();
  const { data: tpl } = await admin
    .from('contract_templates')
    .select('*')
    .eq('id', templateId)
    .maybeSingle();
  if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  // Re-validate the stored layout defensively before cloning.
  const layoutRes = validateFieldLayout(tpl.field_layout);
  const clonedLayout = layoutRes.ok ? layoutRes.layout : [];

  const title = String(body.title || tpl.title || 'Untitled contract').trim();
  const counterparty = String(body.counterparty || '').trim() || null;
  const eventId = typeof body.event_id === 'string' && UUID.test(body.event_id) ? body.event_id : null;

  // 1) New document row (always a contract).
  const { data: doc, error: docErr } = await admin
    .from('documents')
    .insert({ title, category: 'contracts', counterparty, event_id: eventId, created_by: user.id })
    .select()
    .single();
  if (docErr) {
    console.error('[from-template] document insert error', docErr);
    return NextResponse.json({ error: 'Failed to create document.' }, { status: 500 });
  }

  // 2) Copy the template PDF into the new document's first version.
  const { data: blob, error: dlErr } = await admin.storage.from(DOCUMENT_BUCKET).download(tpl.storage_path);
  if (dlErr || !blob) {
    await admin.from('documents').delete().eq('id', doc.id);
    return NextResponse.json({ error: 'Failed to read template file.' }, { status: 500 });
  }
  const buf = Buffer.from(await blob.arrayBuffer());
  const storagePath = buildStoragePath(doc.id, tpl.filename);
  const { error: upErr } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, buf, { contentType: tpl.mime_type || 'application/pdf', upsert: false });
  if (upErr) {
    await admin.from('documents').delete().eq('id', doc.id);
    return NextResponse.json({ error: 'Failed to copy template file.' }, { status: 500 });
  }

  const { data: ver, error: verErr } = await admin
    .from('document_versions')
    .insert({
      document_id: doc.id,
      storage_path: storagePath,
      filename: tpl.filename,
      mime_type: tpl.mime_type || 'application/pdf',
      size_bytes: buf.length,
      checksum_sha256: sha256(buf),
      notes: `Cloned from template “${tpl.title}”.`,
      uploaded_by: user.id,
    })
    .select()
    .single();
  if (verErr) {
    await admin.storage.from(DOCUMENT_BUCKET).remove([storagePath]).catch(() => {});
    await admin.from('documents').delete().eq('id', doc.id);
    return NextResponse.json({ error: 'Failed to record version.' }, { status: 500 });
  }

  // 3) Contract record with the cloned, independently-editable layout.
  const { error: cErr } = await admin
    .from('document_contracts')
    .insert({
      document_id: doc.id,
      template_id: templateId,
      field_layout: clonedLayout,
      field_values: {},
      signature_provider: 'signnow',
      counterparty_name: counterparty,
      event_id: eventId,
      created_by: user.id,
    });
  if (cErr) {
    console.error('[from-template] contract insert error', cErr);
    return NextResponse.json({ error: 'Document created but contract record failed.', document_id: doc.id }, { status: 500 });
  }

  await audit({
    admin, action: 'contract_create', documentId: doc.id, versionId: ver.id,
    actorId: user.id, actorEmail: user.email, request,
    details: { source: 'template', template_id: templateId, field_count: clonedLayout.length },
  });

  return NextResponse.json({ ok: true, document_id: doc.id });
}

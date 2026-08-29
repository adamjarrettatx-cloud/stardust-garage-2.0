import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient, audit, DOCUMENT_BUCKET, DOCUMENT_CATEGORIES } from '@/lib/document-helpers';
import { validateFieldLayout } from '@/lib/contract-fields';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';
import { TEMPLATE_KIND_VALUES } from '@/lib/event-organizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;
const VALID_CATEGORIES = new Set(DOCUMENT_CATEGORIES.map((c) => c.value));

// 404 when the contract-templates feature flag is off; null to proceed.
function templatesDisabled() {
  if (isContractTemplatesEnabled()) return null;
  return NextResponse.json({ error: 'Not found', code: 'FEATURE_DISABLED' }, { status: 404 });
}

// GET /api/admin/templates/:id  -- full template incl. field_layout
export async function GET(request, { params }) {
  const off = templatesDisabled();
  if (off) return off;
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { data: template } = await admin
    .from('contract_templates')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  return NextResponse.json({ ok: true, template });
}

// PATCH /api/admin/templates/:id  -- rename/describe/recategorize, toggle
// active, and/or save the visually-placed field_layout.
export async function PATCH(request, { params }) {
  const off = templatesDisabled();
  if (off) return off;
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const patch = {};
  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (!t) return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    patch.title = t;
  }
  if (typeof body.description === 'string') patch.description = body.description.trim() || null;
  if (typeof body.category === 'string') {
    if (!VALID_CATEGORIES.has(body.category)) return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    patch.category = body.category;
  }
  if (typeof body.is_active === 'boolean') patch.is_active = body.is_active;
  if (typeof body.kind === 'string') {
    if (!TEMPLATE_KIND_VALUES.has(body.kind)) {
      return NextResponse.json({ error: 'Invalid template kind' }, { status: 400 });
    }
    patch.kind = body.kind;
  }
  if (typeof body.requires_master === 'boolean') patch.requires_master = body.requires_master;
  // requires_master only means something for per-event agreements. Resolve the
  // pair against whatever the row will actually be after this patch, so you can
  // flip kind and requires_master in one request without tripping the rule.
  if ('kind' in patch || 'requires_master' in patch) {
    const admin = createAdminClient();
    const { data: current } = await admin
      .from('contract_templates')
      .select('kind, requires_master')
      .eq('id', id)
      .maybeSingle();
    if (!current) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    const nextKind = patch.kind ?? current.kind;
    const nextRequires = 'requires_master' in patch ? patch.requires_master : current.requires_master;
    if (nextRequires && nextKind !== 'event') {
      return NextResponse.json(
        { error: 'Only event templates can require a Master Agreement.' },
        { status: 400 },
      );
    }
  }
  if ('field_layout' in body) {
    const res = validateFieldLayout(body.field_layout);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    patch.field_layout = res.layout;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const admin = createAdminClient();
  const { data: template, error } = await admin
    .from('contract_templates')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error('[templates.update] error', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  await audit({
    admin, action: 'template_update',
    actorId: user.id, actorEmail: user.email, request,
    details: { template_id: id, fields: Object.keys(patch), field_count: patch.field_layout?.length },
  });

  return NextResponse.json({ ok: true, template });
}

// DELETE /api/admin/templates/:id  -- remove a template + its stored PDF.
// Contracts already created from the template keep their own cloned field_layout
// and PDF version, so they are unaffected (template_id FK is nullable).
export async function DELETE(request, { params }) {
  const off = templatesDisabled();
  if (off) return off;
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { data: template } = await admin
    .from('contract_templates')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  // Null out references from contracts so the FK doesn't block deletion; the
  // contract's own cloned field_layout is retained.
  await admin.from('document_contracts').update({ template_id: null }).eq('template_id', id);

  const { error: delErr } = await admin.from('contract_templates').delete().eq('id', id);
  if (delErr) {
    console.error('[templates.delete] error', delErr);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
  await admin.storage.from(DOCUMENT_BUCKET).remove([template.storage_path]).catch(() => {});

  await audit({
    admin, action: 'template_delete',
    actorId: user.id, actorEmail: user.email, request,
    details: { template_id: id },
  });

  return NextResponse.json({ ok: true });
}

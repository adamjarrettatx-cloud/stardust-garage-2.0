import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient, audit, DOCUMENT_BUCKET, DOCUMENT_CATEGORIES } from '@/lib/document-helpers';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f-]{36}$/i;
const VALID_CATEGORIES = new Set(DOCUMENT_CATEGORIES.map((c) => c.value));

// PATCH /api/admin/documents/:id  -- update metadata and tags
export async function PATCH(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const patch = {};
  if (typeof body.title === 'string')        patch.title = body.title.trim();
  if (typeof body.description === 'string')  patch.description = body.description.trim() || null;
  if (typeof body.counterparty === 'string') patch.counterparty = body.counterparty.trim() || null;
  if (typeof body.category === 'string') {
    if (!VALID_CATEGORIES.has(body.category)) return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    patch.category = body.category;
  }
  if (typeof body.status === 'string') {
    if (!['draft', 'active', 'archived'].includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    patch.status = body.status;
  }
  if (body.event_id === null) patch.event_id = null;
  else if (typeof body.event_id === 'string' && UUID.test(body.event_id)) patch.event_id = body.event_id;

  const admin = createAdminClient();

  if (Object.keys(patch).length) {
    const { error } = await admin.from('documents').update(patch).eq('id', id);
    if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  // Replace tags if provided
  if (Array.isArray(body.tags)) {
    const tags = body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 20);
    await admin.from('document_tags').delete().eq('document_id', id);
    if (tags.length) {
      await admin.from('document_tags').insert(tags.map((tag) => ({ document_id: id, tag })));
    }
  }

  await audit({
    admin, action: 'update_metadata', documentId: id,
    actorId: user.id, actorEmail: user.email, request, details: { patch, tags: body.tags ?? null },
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/documents/:id  -- hard delete with cascade + storage cleanup
export async function DELETE(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();

  // Collect storage paths first
  const { data: versions } = await admin
    .from('document_versions')
    .select('storage_path')
    .eq('document_id', id);

  // Audit BEFORE delete so we still have FK validity
  await audit({
    admin, action: 'delete', documentId: id,
    actorId: user.id, actorEmail: user.email, request,
    details: { version_count: versions?.length || 0 },
  });

  // Delete row (cascades to versions + tags; audit log keeps history because FK ON DELETE SET NULL)
  const { error: delErr } = await admin.from('documents').delete().eq('id', id);
  if (delErr) return NextResponse.json({ error: 'Delete failed' }, { status: 500 });

  if (versions?.length) {
    await admin.storage.from(DOCUMENT_BUCKET).remove(versions.map((v) => v.storage_path));
  }

  return NextResponse.json({ ok: true });
}

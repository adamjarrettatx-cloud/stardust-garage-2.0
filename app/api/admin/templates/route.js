import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { requireAdminMfa } from '@/lib/auth-helpers';
import {
  createAdminClient,
  audit,
  sha256,
  MAX_BYTES,
  DOCUMENT_BUCKET,
  DOCUMENT_CATEGORIES,
} from '@/lib/document-helpers';
import { buildTemplateStoragePath, readPdfMeta, TEMPLATE_MIME } from '@/lib/template-helpers';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';
import { TEMPLATE_KIND_VALUES } from '@/lib/event-organizer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = new Set(DOCUMENT_CATEGORIES.map((c) => c.value));

// Guard for the feature-flagged contract-templates endpoints. Returns a 404
// response when the feature is off so the routes are unreachable, or null to
// proceed. 404 (not 403) keeps the disabled feature invisible.
function templatesDisabled() {
  if (isContractTemplatesEnabled()) return null;
  return NextResponse.json({ error: 'Not found', code: 'FEATURE_DISABLED' }, { status: 404 });
}

// GET /api/admin/templates?include=inactive
//   List templates (active only by default). Excludes the raw field_layout blob
//   from the list payload — it can be large; the detail route returns it.
export async function GET(request) {
  const off = templatesDisabled();
  if (off) return off;
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  const includeInactive = new URL(request.url).searchParams.get('include') === 'inactive';
  const admin = createAdminClient();
  let query = admin
    .from('contract_templates')
    .select('id, title, description, category, kind, requires_master, filename, mime_type, size_bytes, page_count, field_layout, is_active, created_at, updated_at')
    .order('updated_at', { ascending: false });
  if (!includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) {
    console.error('[templates.list] error', error);
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }

  // Summarize field_layout to a count so the list stays lean.
  const templates = (data || []).map((t) => ({
    ...t,
    field_count: Array.isArray(t.field_layout) ? t.field_layout.length : 0,
    field_layout: undefined,
  }));
  return NextResponse.json({ ok: true, templates });
}

// POST /api/admin/templates  -- multipart/form-data: create a template from a
// PDF upload. PDF-only for v1 (field coordinates must be placed against a fixed,
// reliably-rendered PDF). Reads the page count via pdf-lib up front so the
// editor knows how many pages to render.
export async function POST(request) {
  const off = templatesDisabled();
  if (off) return off;
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
  }

  const title = String(form.get('title') || '').trim();
  const description = String(form.get('description') || '').trim();
  const category = String(form.get('category') || 'contracts').trim();
  // kind drives the profile-first flow: a 'master' template produces the
  // umbrella agreement an organizer signs once, an 'event' template produces the
  // per-event agreement that can reference it. Default 'other' keeps every
  // pre-existing template behaving exactly as before.
  const kind = String(form.get('kind') || 'other').trim();
  const requiresMaster = String(form.get('requires_master') || '') === 'true';
  const file = form.get('file');

  if (!title) return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
  if (!VALID_CATEGORIES.has(category)) return NextResponse.json({ error: 'Invalid category.' }, { status: 400 });
  if (!TEMPLATE_KIND_VALUES.has(kind)) return NextResponse.json({ error: 'Invalid template kind.' }, { status: 400 });
  if (requiresMaster && kind !== 'event') {
    return NextResponse.json({ error: 'Only event templates can require a Master Agreement.' }, { status: 400 });
  }
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'A PDF file is required.' }, { status: 400 });
  if (file.type !== TEMPLATE_MIME) {
    return NextResponse.json({ error: 'Templates must be PDF files. Convert to PDF and try again.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File exceeds 100 MB limit.' }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const meta = await readPdfMeta(buf);
  if (!meta) return NextResponse.json({ error: 'Could not read that PDF. It may be corrupt or password-protected.' }, { status: 400 });

  const admin = createAdminClient();
  const templateId = crypto.randomUUID();
  const storagePath = buildTemplateStoragePath(templateId, file.name);

  const { error: upErr } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, buf, { contentType: TEMPLATE_MIME, upsert: false });
  if (upErr) {
    console.error('[templates.create] storage error', upErr);
    return NextResponse.json({ error: 'Failed to upload template.' }, { status: 500 });
  }

  const { data: tpl, error: insErr } = await admin
    .from('contract_templates')
    .insert({
      id: templateId,
      title,
      description: description || null,
      category,
      kind,
      requires_master: requiresMaster,
      storage_path: storagePath,
      filename: file.name,
      mime_type: TEMPLATE_MIME,
      size_bytes: file.size,
      checksum_sha256: sha256(buf),
      page_count: meta.pageCount,
      field_layout: [],
      created_by: user.id,
    })
    .select()
    .single();

  if (insErr) {
    console.error('[templates.create] insert error', insErr);
    await admin.storage.from(DOCUMENT_BUCKET).remove([storagePath]).catch(() => {});
    return NextResponse.json({ error: 'Failed to record template.' }, { status: 500 });
  }

  await audit({
    admin, action: 'template_create',
    actorId: user.id, actorEmail: user.email, request,
    details: { template_id: templateId, filename: file.name, pages: meta.pageCount, kind, requires_master: requiresMaster },
  });

  return NextResponse.json({ ok: true, template: tpl });
}

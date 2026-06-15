import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import {
  createAdminClient,
  audit,
  buildStoragePath,
  sha256,
  isAllowedMime,
  MAX_BYTES,
  DOCUMENT_BUCKET,
  DOCUMENT_CATEGORIES,
} from '@/lib/document-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_CATEGORIES = new Set(DOCUMENT_CATEGORIES.map((c) => c.value));

// POST /api/admin/documents  -- multipart/form-data: create new document + first version
export async function POST(request) {
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
  const category = String(form.get('category') || '').trim();
  const counterparty = String(form.get('counterparty') || '').trim();
  const eventIdRaw = String(form.get('event_id') || '').trim();
  const tagsRaw = String(form.get('tags') || '').trim();
  const file = form.get('file');

  if (!title)                     return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
  if (!VALID_CATEGORIES.has(category)) return NextResponse.json({ error: 'Invalid category.' }, { status: 400 });
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'File is required.' }, { status: 400 });
  if (!isAllowedMime(file.type))  return NextResponse.json({ error: `File type not allowed: ${file.type || 'unknown'}` }, { status: 400 });
  if (file.size > MAX_BYTES)      return NextResponse.json({ error: 'File exceeds 100 MB limit.' }, { status: 400 });

  const event_id = eventIdRaw && /^[0-9a-f-]{36}$/i.test(eventIdRaw) ? eventIdRaw : null;
  const tags = tagsRaw
    ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 20)
    : [];

  const admin = createAdminClient();

  // 1. Create document row
  const { data: doc, error: docErr } = await admin
    .from('documents')
    .insert({
      title,
      description: description || null,
      category,
      counterparty: counterparty || null,
      event_id,
      created_by: user.id,
    })
    .select()
    .single();

  if (docErr) {
    console.error('[documents.create] insert error', docErr);
    return NextResponse.json({ error: 'Failed to create document.' }, { status: 500 });
  }

  // 2. Upload to storage
  const arrayBuf = await file.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const storagePath = buildStoragePath(doc.id, file.name);

  const { error: upErr } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, buf, { contentType: file.type, upsert: false });

  if (upErr) {
    console.error('[documents.create] storage error', upErr);
    // Rollback the documents row
    await admin.from('documents').delete().eq('id', doc.id);
    return NextResponse.json({ error: 'Failed to upload file.' }, { status: 500 });
  }

  // 3. Insert version row
  const { data: ver, error: verErr } = await admin
    .from('document_versions')
    .insert({
      document_id: doc.id,
      storage_path: storagePath,
      filename: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      checksum_sha256: sha256(buf),
      uploaded_by: user.id,
    })
    .select()
    .single();

  if (verErr) {
    console.error('[documents.create] version error', verErr);
    await admin.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
    await admin.from('documents').delete().eq('id', doc.id);
    return NextResponse.json({ error: 'Failed to record version.' }, { status: 500 });
  }

  // 4. Tags
  if (tags.length) {
    await admin.from('document_tags').insert(tags.map((tag) => ({ document_id: doc.id, tag })));
  }

  // 5. Audit
  await audit({
    admin,
    action: 'upload',
    documentId: doc.id,
    versionId: ver.id,
    actorId: user.id,
    actorEmail: user.email,
    request,
    details: { filename: file.name, size: file.size },
  });

  return NextResponse.json({ ok: true, document_id: doc.id });
}

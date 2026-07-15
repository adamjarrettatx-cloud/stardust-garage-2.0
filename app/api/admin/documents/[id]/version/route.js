import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import {
  createAdminClient, audit, buildStoragePath, sha256,
  isAllowedMime, MAX_BYTES, DOCUMENT_BUCKET,
} from '@/lib/document-helpers';
import { extractText } from '@/lib/document-text-extract';

export const runtime = 'nodejs';
const UUID = /^[0-9a-f-]{36}$/i;

// POST /api/admin/documents/:id/version  -- multipart: add a new version to an existing doc
export async function POST(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  let form;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: 'Bad body' }, { status: 400 }); }

  const file = form.get('file');
  const notes = String(form.get('notes') || '').trim();

  if (!file || typeof file === 'string')   return NextResponse.json({ error: 'File required' }, { status: 400 });
  if (!isAllowedMime(file.type))           return NextResponse.json({ error: `File type not allowed: ${file.type || 'unknown'}` }, { status: 400 });
  if (file.size > MAX_BYTES)               return NextResponse.json({ error: 'File exceeds 100 MB limit.' }, { status: 400 });

  const admin = createAdminClient();

  // Ensure document exists
  const { data: doc } = await admin.from('documents').select('id').eq('id', id).maybeSingle();
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

  const buf = Buffer.from(await file.arrayBuffer());
  const storagePath = buildStoragePath(id, file.name);

  const { error: upErr } = await admin.storage
    .from(DOCUMENT_BUCKET)
    .upload(storagePath, buf, { contentType: file.type, upsert: false });
  if (upErr) return NextResponse.json({ error: 'Upload failed' }, { status: 500 });

  const extracted_text = extractText(buf, file.type, file.name) || null;
  const { data: ver, error: verErr } = await admin
    .from('document_versions')
    .insert({
      document_id: id,
      storage_path: storagePath,
      filename: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      checksum_sha256: sha256(buf),
      notes: notes || null,
      extracted_text,
      uploaded_by: user.id,
    })
    .select()
    .single();

  if (verErr) {
    await admin.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: 'Failed to record version' }, { status: 500 });
  }

  await audit({
    admin, action: 'new_version', documentId: id, versionId: ver.id,
    actorId: user.id, actorEmail: user.email, request,
    details: { filename: file.name, size: file.size, version_number: ver.version_number },
  });

  return NextResponse.json({ ok: true, version_id: ver.id, version_number: ver.version_number });
}

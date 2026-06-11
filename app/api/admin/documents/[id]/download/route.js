import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-helpers';
import { createAdminClient, audit, DOCUMENT_BUCKET } from '@/lib/document-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/admin/documents/:id/download?version=<uuid>&inline=1
//   - default: latest version, as attachment
//   - inline=1: render in browser (for PDF/image preview)
//   - version: pin a specific version
//
// SECURITY: Files are never exposed via public storage URLs. This route
// validates admin status, fetches the file via the service role, and streams
// the bytes through Next.js. The signed URL never leaves the server.
export async function GET(request, { params }) {
  const { user, unauthorized } = await requireAdmin();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const url = new URL(request.url);
  const versionParam = url.searchParams.get('version');
  const inline = url.searchParams.get('inline') === '1';

  const admin = createAdminClient();

  // Resolve version
  let q = admin.from('document_versions').select('*').eq('document_id', id);
  if (versionParam && UUID.test(versionParam)) q = q.eq('id', versionParam);
  else q = q.order('version_number', { ascending: false }).limit(1);
  const { data: ver } = await q.maybeSingle();

  if (!ver) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: blob, error } = await admin.storage.from(DOCUMENT_BUCKET).download(ver.storage_path);
  if (error || !blob) return NextResponse.json({ error: 'Storage error' }, { status: 500 });

  await audit({
    admin, action: inline ? 'view' : 'download',
    documentId: id, versionId: ver.id,
    actorId: user.id, actorEmail: user.email, request,
    details: { filename: ver.filename, version_number: ver.version_number },
  });

  // Encode filename safely for Content-Disposition (RFC 5987)
  const safeName = ver.filename.replace(/"/g, '');
  const dispo = `${inline ? 'inline' : 'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(ver.filename)}`;

  return new Response(blob.stream(), {
    headers: {
      'Content-Type': ver.mime_type || 'application/octet-stream',
      'Content-Disposition': dispo,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

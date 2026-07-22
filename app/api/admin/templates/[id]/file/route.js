import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient, DOCUMENT_BUCKET } from '@/lib/document-helpers';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/admin/templates/:id/file
//   Stream the template PDF bytes (inline) so the visual field editor can render
//   its pages. Same private-bucket streaming discipline as the document download
//   route — the storage signed URL never leaves the server.
export async function GET(request, { params }) {
  if (!isContractTemplatesEnabled()) {
    return NextResponse.json({ error: 'Not found', code: 'FEATURE_DISABLED' }, { status: 404 });
  }
  const { unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { data: tpl } = await admin
    .from('contract_templates')
    .select('storage_path, filename, mime_type')
    .eq('id', id)
    .maybeSingle();
  if (!tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const { data: blob, error } = await admin.storage.from(DOCUMENT_BUCKET).download(tpl.storage_path);
  if (error || !blob) return NextResponse.json({ error: 'Storage error' }, { status: 500 });

  const safeName = (tpl.filename || 'template.pdf').replace(/"/g, '');
  return new Response(blob.stream(), {
    headers: {
      'Content-Type': tpl.mime_type || 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

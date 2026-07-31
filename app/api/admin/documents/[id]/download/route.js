import { NextResponse } from 'next/server';
import { requireAdminMfa } from '@/lib/auth-helpers';
import { createAdminClient, streamDocumentVersion } from '@/lib/document-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/admin/documents/:id/download?version=<uuid>&inline=1
//   - default: latest version, as attachment
//   - inline=1: render in browser (for PDF/image preview)
//   - version: pin a specific version
//
// SECURITY: Files are never exposed via public storage URLs. This route
// validates admin status, then streamDocumentVersion() fetches the file via the
// service role and streams the bytes through Next.js.
export async function GET(request, { params }) {
  const { user, unauthorized, reason } = await requireAdminMfa();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const url = new URL(request.url);

  return streamDocumentVersion({
    admin: createAdminClient(),
    documentId: id,
    versionId: url.searchParams.get('version'),
    inline: url.searchParams.get('inline') === '1',
    actor: user,
    request,
  });
}

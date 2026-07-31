import { NextResponse } from 'next/server';
import { requireTeam } from '@/lib/auth-helpers';
import { createAdminClient, streamDocumentVersion } from '@/lib/document-helpers';
import { isTeamVisibleDocument } from '@/lib/document-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// GET /api/team/documents/:id/download?inline=1
//
// The team-role counterpart of /api/admin/documents/:id/download, restricted to
// SOPs. Two gates, both server-side: the caller must be staff (requireTeam),
// and the document itself must be a published SOP — re-read here with the
// service role so swapping in a contract id yields a 404 rather than the file.
// Only the current version is reachable; version history stays admin-only.
export async function GET(request, { params }) {
  const { user, unauthorized } = await requireTeam();
  if (unauthorized) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 });

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from('documents')
    .select('id, category, status')
    .eq('id', id)
    .maybeSingle();

  if (!isTeamVisibleDocument(doc)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return streamDocumentVersion({
    admin,
    documentId: id,
    inline: new URL(request.url).searchParams.get('inline') === '1',
    actor: user,
    request,
  });
}

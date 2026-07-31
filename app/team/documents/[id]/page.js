import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireTeam } from '@/lib/auth-helpers';
import { isTeamVisibleDocument } from '@/lib/document-access';
import SopDetailClient from './SopDetailClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// Read-only SOP viewer for team members. This is where the middleware sends a
// team member who followed a /bananas/documents/:id link, so it must cope with
// ids that turn out not to be SOPs — those 404 rather than leaking a title.
export default async function TeamDocumentPage({ params }) {
  const { unauthorized, isAdmin } = await requireTeam();
  if (unauthorized) redirect('/login');

  const { id } = await params;
  if (!UUID.test(id)) notFound();

  // Admins get the full hub view: versions, audit trail and edit controls.
  if (isAdmin) redirect(`/bananas/documents/${id}`);

  const supabase = await createClient();
  const { data: doc } = await supabase
    .from('documents')
    .select(`
      id, title, description, category, status, updated_at,
      document_versions:current_version_id ( filename, mime_type, size_bytes, uploaded_at ),
      document_tags ( tag )
    `)
    .eq('id', id)
    .maybeSingle();

  if (!isTeamVisibleDocument(doc)) notFound();

  return (
    <main className="max-w-[900px] mx-auto px-6 py-16">
      <SopDetailClient document={doc} />
    </main>
  );
}

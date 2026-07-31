import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireTeam } from '@/lib/auth-helpers';
import { TEAM_VISIBLE_CATEGORIES } from '@/lib/document-access';
import SopLibraryClient from './SopLibraryClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Read-only SOP library for team members. The full document hub at
// /bananas/documents stays admin-only — this route exposes published SOPs and
// nothing else, so contracts, finance and vendor paperwork remain invisible.
// RLS (20260803_team_visible_sops.sql) enforces the same carve-out at the
// database, so the filters below are convenience, not the security boundary.
export default async function TeamDocumentsPage() {
  const { unauthorized, isAdmin } = await requireTeam();
  if (unauthorized) redirect('/login');

  const supabase = await createClient();
  const { data: documents, error } = await supabase
    .from('documents')
    .select(`
      id, title, description, category, updated_at,
      document_versions:current_version_id ( filename, mime_type, size_bytes, uploaded_at )
    `)
    .in('category', TEAM_VISIBLE_CATEGORIES)
    .eq('status', 'active')
    .order('title', { ascending: true });

  return (
    <main className="max-w-[900px] mx-auto px-6 py-16">
      <SopLibraryClient
        documents={documents || []}
        error={error?.message || null}
        isAdmin={isAdmin}
      />
    </main>
  );
}

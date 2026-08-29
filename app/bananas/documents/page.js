import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import { DOCUMENT_CATEGORIES } from '@/lib/document-helpers';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';
import DocumentsClient from './DocumentsClient';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function DocumentsPage({ searchParams }) {
  // Defense-in-depth: middleware already gated /admin/*, but verify here too.
  // adminPageGate also routes to /admin/security when MFA is enforced but the
  // session hasn't stepped up — avoids a dead end for un-enrolled admins.
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const sp = await searchParams;
  const q        = (sp?.q || '').toString().trim();
  // Contracts is the default view now that the "All" tab is gone — one of the
  // category tabs is always the active one.
  const category = (sp?.category || 'contracts').toString().trim();
  // The status dropdown was removed from the toolbar. Nothing is hidden by
  // default anymore; non-active docs still show their status chip in the list.
  const status   = (sp?.status || 'all').toString().trim();

  const supabase = await createClient();

  // RLS confines us to admin-readable rows automatically. We also pass through
  // a service-role view of tags so we don't double-fetch per row.
  let query = supabase
    .from('documents')
    .select(`
      id, title, description, category, counterparty, status, event_id,
      current_version_id, created_at, updated_at,
      events:event_id ( id, title, event_date ),
      document_versions:current_version_id ( filename, mime_type, size_bytes, version_number, uploaded_at ),
      document_tags ( tag ),
      document_contracts ( status )
    `)
    .order('updated_at', { ascending: false });

  if (status && status !== 'all') query = query.eq('status', status);
  if (category)                    query = query.eq('category', category);
  if (q) query = query.or(
    `title.ilike.%${q}%,counterparty.ilike.%${q}%,description.ilike.%${q}%`
  );

  const { data: documents, error } = await query;

  const { data: events } = await supabase
    .from('events')
    .select('id, title, event_date')
    .order('event_date', { ascending: false })
    .limit(200);

  return (
    <>
      <AuthenticatedPageHeader
        title="Documents"
        description="Contracts, vendor docs, SOPs, finance — every upload is logged. Files never leave a private bucket."
        eyebrow="PRIVATE · ADMIN ONLY"
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
        showThemeToggle={false}
      />

      <DocumentsClient
        initialDocuments={documents || []}
        initialError={error?.message || null}
        events={events || []}
        categories={DOCUMENT_CATEGORIES}
        filters={{ q, category, status }}
        contractTemplatesEnabled={isContractTemplatesEnabled()}
      />
    </>
  );
}

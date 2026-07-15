import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import { DOCUMENT_CATEGORIES } from '@/lib/document-helpers';
import DocumentsClient from './DocumentsClient';

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
  const category = (sp?.category || '').toString().trim();
  const status   = (sp?.status || 'active').toString().trim();

  const supabase = await createClient();

  // Columns + embedded relations the list UI renders. RLS confines every path
  // below to admin-readable rows automatically (public.is_admin()).
  const SELECT = `
    id, title, description, category, counterparty, status, event_id,
    current_version_id, created_at, updated_at,
    events:event_id ( id, title, event_date ),
    document_versions:current_version_id ( filename, mime_type, size_bytes, version_number, uploaded_at ),
    document_tags ( tag ),
    document_contracts ( status )
  `;

  // With a search term, go through the search_documents RPC: it runs Postgres
  // full-text search over the enriched search_tsv (which now includes extracted
  // file text), complemented by an ilike substring match, and returns rows
  // ranked by relevance. Without a term, the plain table query preserves the
  // existing "browse by most-recently-updated" behavior.
  let documents, error;
  if (q) {
    ({ data: documents, error } = await supabase
      .rpc('search_documents', {
        p_q: q,
        p_status: status || 'active',
        p_category: category || null,
      })
      .select(SELECT));
  } else {
    let query = supabase.from('documents').select(SELECT)
      .order('updated_at', { ascending: false });
    if (status && status !== 'all') query = query.eq('status', status);
    if (category)                    query = query.eq('category', category);
    ({ data: documents, error } = await query);
  }

  const { data: events } = await supabase
    .from('events')
    .select('id, title, event_date')
    .order('event_date', { ascending: false })
    .limit(200);

  return (
    <main className="max-w-[1100px] mx-auto px-6 py-16">
      <Link
        href="/admin"
        className="text-[12px] tracking-[0.14em] mb-4 inline-block hover:text-white transition-colors"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO ADMIN
      </Link>
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1
          className="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1]"
          style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
        >
          Documents
        </h1>
        <div className="text-[11px] tracking-[0.18em]" style={{ color: '#8a8a8a' }}>
          PRIVATE · ADMIN ONLY
        </div>
      </div>
      <p className="mb-8 text-[14px]" style={{ color: '#8a8a8a' }}>
        Contracts, vendor docs, SOPs, finance — every upload is logged. Files never leave a private bucket.
      </p>

      <DocumentsClient
        initialDocuments={documents || []}
        initialError={error?.message || null}
        events={events || []}
        categories={DOCUMENT_CATEGORIES}
        filters={{ q, category, status }}
      />
    </main>
  );
}

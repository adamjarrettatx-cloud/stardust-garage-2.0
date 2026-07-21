import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import { DOCUMENT_CATEGORIES } from '@/lib/document-helpers';
import { isSignNowConfigured } from '@/lib/signnow';
import DocumentDetailClient from './DocumentDetailClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function DocumentDetailPage({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();

  const { data: doc } = await supabase
    .from('documents')
    .select(`
      *,
      events:event_id ( id, title, event_date ),
      document_tags ( tag )
    `)
    .eq('id', id)
    .maybeSingle();

  if (!doc) notFound();

  const { data: versions } = await supabase
    .from('document_versions')
    .select('*')
    .eq('document_id', id)
    .order('version_number', { ascending: false });

  const { data: audit } = await supabase
    .from('document_audit_log')
    .select('*')
    .eq('document_id', id)
    .order('created_at', { ascending: false })
    .limit(100);

  const { data: events } = await supabase
    .from('events')
    .select('id, title, event_date')
    .order('event_date', { ascending: false })
    .limit(200);

  // Contract lifecycle record is optional and only relevant for contract docs.
  let contract = null;
  if (doc.category === 'contracts') {
    const { data: c } = await supabase
      .from('document_contracts')
      .select('*')
      .eq('document_id', id)
      .maybeSingle();
    contract = c || null;
  }

  return (
    <main className="max-w-[900px] mx-auto px-6 py-16">
      <Link
        href="/bananas/documents"
        className="text-[12px] tracking-[0.14em] mb-4 inline-block hover:text-white transition-colors"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO DOCUMENTS
      </Link>
      <DocumentDetailClient
        document={doc}
        versions={versions || []}
        audit={audit || []}
        events={events || []}
        categories={DOCUMENT_CATEGORIES}
        contract={contract}
        signNowConfigured={isSignNowConfigured()}
      />
    </main>
  );
}

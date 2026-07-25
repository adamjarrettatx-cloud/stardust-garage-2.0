import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { adminPageGate } from '@/lib/auth-helpers';
import { DOCUMENT_CATEGORIES } from '@/lib/document-helpers';
import { isSignNowConfigured } from '@/lib/signnow';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';
import DocumentDetailClient from './DocumentDetailClient';
import { AuthenticatedPageSurface } from '@/app/components/AuthenticatedPageTheme';

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
    <AuthenticatedPageSurface
      scope="admin"
      width="max-w-[900px]"
      className="transition-colors duration-150"
      testId="route-bananas-documents-id"
    >
      <DocumentDetailClient
        document={doc}
        versions={versions || []}
        audit={audit || []}
        events={events || []}
        categories={DOCUMENT_CATEGORIES}
        contract={contract}
        signNowConfigured={isSignNowConfigured()}
        contractTemplatesEnabled={isContractTemplatesEnabled()}
      />
    </AuthenticatedPageSurface>
  );
}

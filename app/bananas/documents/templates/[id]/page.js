import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { DOCUMENT_CATEGORIES } from '@/lib/document-helpers';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';
import TemplateEditorClient from './TemplateEditorClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function TemplateEditorPage({ params }) {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  // Feature-flagged off by default: the editor route is unreachable while the
  // contract-templates feature is hidden.
  if (!isContractTemplatesEnabled()) redirect('/bananas/documents');

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  return (
    <main className="max-w-[900px] mx-auto px-6 py-16">
      <Link
        href="/bananas/documents/templates"
        className="text-[12px] tracking-[0.14em] mb-4 inline-block hover:text-white transition-colors"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO TEMPLATES
      </Link>
      <TemplateEditorClient templateId={id} categories={DOCUMENT_CATEGORIES} />
    </main>
  );
}

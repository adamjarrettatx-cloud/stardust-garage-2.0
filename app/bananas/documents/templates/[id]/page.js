import { redirect, notFound } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { DOCUMENT_CATEGORIES } from '@/lib/document-helpers';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';
import TemplateEditorClient from './TemplateEditorClient';
import { AuthenticatedPageSurface } from '@/app/components/AuthenticatedPageTheme';

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
    <AuthenticatedPageSurface
      scope="admin"
      width="max-w-[900px]"
      className="transition-colors duration-150"
      testId="route-bananas-documents-templates-id"
    >
      <TemplateEditorClient templateId={id} categories={DOCUMENT_CATEGORIES} />
    </AuthenticatedPageSurface>
  );
}

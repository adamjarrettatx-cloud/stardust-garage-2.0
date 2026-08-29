import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { DOCUMENT_CATEGORIES } from '@/lib/document-helpers';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';
import TemplatesClient from './TemplatesClient';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Template library. contract_templates has RLS enabled with NO policies (only
// the service-role admin client can read it), so the list is loaded client-side
// via the requireAdminMfa()-gated API route rather than the user-scoped server
// client used elsewhere on this page.
export default async function TemplatesPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  // Feature-flagged off by default: send admins back to Documents rather than
  // render an editor for a feature that's currently hidden.
  if (!isContractTemplatesEnabled()) redirect('/bananas/documents');

  return (
    <div className="max-w-[1000px]">
      <AuthenticatedPageHeader
        backHref="/bananas/documents"
        backLabel="← BACK TO DOCUMENTS"
        title="Contract Templates"
        description="Upload a reusable contract PDF, then place fields on it. Create contracts from a template to clone its layout — the recipient-fillable fields stay editable per contract."
        eyebrow="PRIVATE · ADMIN ONLY"
        titleClassName="text-[30px] font-extrabold -tracking-[0.02em] leading-[1.15]"
      />

      <TemplatesClient categories={DOCUMENT_CATEGORIES} />
    </div>
  );
}

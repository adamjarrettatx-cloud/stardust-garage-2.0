import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { DOCUMENT_CATEGORIES } from '@/lib/document-helpers';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';
import TemplatesClient from './TemplatesClient';
import {
  AuthenticatedPageHeader,
  AuthenticatedPageSurface,
} from '@/app/components/AuthenticatedPageTheme';

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
    <AuthenticatedPageSurface
      scope="admin"
      width="max-w-[1000px]"
      className="transition-colors duration-150"
      testId="route-bananas-documents-templates"
    >
      <AuthenticatedPageHeader
        scope="admin"
        backHref="/bananas/documents"
        title="Contract Templates"
        subtitle="Upload a reusable contract PDF, then place fields on it. Create contracts from a template to clone its layout — the recipient-fillable fields stay editable per contract."
        right={(
          <div className="text-[11px] tracking-[0.18em]" style={{ color: 'var(--auth-muted)' }}>
            PRIVATE · ADMIN ONLY
          </div>
        )}
      />
      <TemplatesClient categories={DOCUMENT_CATEGORIES} />
    </AuthenticatedPageSurface>
  );
}

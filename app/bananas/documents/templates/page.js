import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import { DOCUMENT_CATEGORIES } from '@/lib/document-helpers';
import { isContractTemplatesEnabled } from '@/lib/feature-flags';
import TemplatesClient from './TemplatesClient';

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
    <main className="max-w-[1000px] mx-auto px-6 py-16">
      <Link
        href="/bananas/documents"
        className="text-[12px] tracking-[0.14em] mb-4 inline-block hover:text-white transition-colors"
        style={{ color: '#8a8a8a' }}
      >
        ← BACK TO DOCUMENTS
      </Link>
      <div className="flex items-baseline justify-between gap-4 mb-2">
        <h1 className="text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
          Contract Templates
        </h1>
        <div className="text-[11px] tracking-[0.18em]" style={{ color: '#8a8a8a' }}>PRIVATE · ADMIN ONLY</div>
      </div>
      <p className="mb-8 text-[14px]" style={{ color: '#8a8a8a' }}>
        Upload a reusable contract PDF, then place fields on it. Create contracts from a template to
        clone its layout — the recipient-fillable fields stay editable per contract.
      </p>

      <TemplatesClient categories={DOCUMENT_CATEGORIES} />
    </main>
  );
}

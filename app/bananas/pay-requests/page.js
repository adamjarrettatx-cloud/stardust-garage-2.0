import { redirect } from 'next/navigation';
import { adminPageGate } from '@/lib/auth-helpers';
import AuthenticatedPageHeader from '@/app/components/AuthenticatedPageHeader';
import PayRequestsClient from './PayRequestsClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

// Artist / DJ Pay System — Phase 3: Review & Pay + 1099 tracking.
//
// All the actual data loading and mutation (approve/reject/reopen) happens
// client-side through adminFetch, same split as ArtistLineupPanel: this file
// is only the server-side auth gate + page chrome.
export default async function PayRequestsPage() {
  const { redirect: gate } = await adminPageGate();
  if (gate) redirect(gate);

  return (
    <main className="max-w-[1000px] mx-auto px-6 py-16">
      <AuthenticatedPageHeader
        title="Artist Pay"
        description="Review pay requests and track cumulative pay per contractor."
        titleClassName="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
        className="mb-10"
      />
      <PayRequestsClient />
    </main>
  );
}

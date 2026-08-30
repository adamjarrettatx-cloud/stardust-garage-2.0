import { redirect } from 'next/navigation';
import { requirePartner } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import PortalContractCard from './PortalContractCard';

export const revalidate = 0;

// THE COUNTERPARTY'S SIDE OF THE CONTRACT.
//
// Read-only by design. Signing itself happens in the SignNow invite emailed to
// the signer — this page never contains a signing link, an envelope id, or a
// storage URL. It exists so an organizer can answer "what have I got out with
// Stardust, and what did I already sign?" from a logged-in page instead of
// digging through email.
//
// Data comes from partner_contracts(), a SECURITY DEFINER RPC scoped to the
// caller's own contact via partner_contact_id(). It excludes drafts and returns
// only safe columns, so there is no path from here to another party's contract
// and no admin RLS was loosened to build this page.
export default async function PortalContractsPage() {
  const { unauthorized } = await requirePartner();
  if (unauthorized) redirect('/portal/login');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('partner_contracts');

  if (error) {
    console.error('[portal contracts] partner_contracts failed', error);
  }

  const contracts = data || [];
  const awaiting = contracts.filter((c) => ['sent', 'partially_signed'].includes(c.status));

  return (
    <main className="max-w-[720px] mx-auto px-5 sm:px-6 py-10 sm:py-14">
      <div className="text-[11px] font-semibold tracking-[0.28em] mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
        CONTRACTS
      </div>
      <h1
        className="text-[30px] sm:text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-3"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Your agreements with us.
      </h1>
      <p className="text-[14px] leading-[1.6] mb-9" style={{ color: '#8a8a8a' }}>
        {awaiting.length > 0
          ? `You have ${awaiting.length} agreement${awaiting.length === 1 ? '' : 's'} waiting on a signature. Signing happens through the secure signature email we sent you — this page is your record of what is outstanding and what is done.`
          : 'Everything we have on paper with you, newest first. Signing happens through the secure signature email we send when a new agreement goes out.'}
      </p>

      {error && (
        <div
          className="rounded-[12px] border p-4 mb-6 text-[13px]"
          style={{ background: 'rgba(251,191,36,0.10)', borderColor: 'rgba(251,191,36,0.3)', color: '#fbbf24' }}
        >
          We couldn&rsquo;t load your contracts just now. Try again in a moment, or email{' '}
          <a href="mailto:hello@sdgatx.com" className="underline">hello@sdgatx.com</a> and we&rsquo;ll send them over.
        </div>
      )}

      {contracts.length === 0 ? (
        <div
          className="rounded-[16px] border p-8 sm:p-12 text-center"
          style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <p className="text-[15px] leading-[1.6]" style={{ color: '#a0a0a0' }}>
            Nothing here yet — this fills in when we send you an agreement to sign.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {contracts.map((c) => (
            <PortalContractCard key={c.contract_id} contract={c} />
          ))}
        </div>
      )}
    </main>
  );
}

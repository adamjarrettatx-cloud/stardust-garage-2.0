import { redirect } from 'next/navigation';
import { requirePartner } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import { splitGrantsByDate } from '@/lib/guestlist-helpers';
import GrantCard from './GrantCard';

export const revalidate = 0;

// Every allocation this partner holds.
//
// Read through public.partner_grants() rather than selecting the grants and
// joining events: a partner has no select policy on events, so a grant for a
// draft or internal-visibility event — which is precisely when a promoter is
// building their list, before the night is announced — would render with no
// name and no date. The RPC is security definer and scoped to
// partner_contact_id(), and it returns the used counts alongside, computed by
// the same rule the capacity trigger enforces.
export default async function PartnerGuestListPage() {
  const { unauthorized } = await requirePartner();
  if (unauthorized) redirect('/portal/login');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('partner_grants');

  if (error) {
    console.error('[partner guest-list] partner_grants failed', error);
  }

  const { upcoming, past } = splitGrantsByDate(data || []);

  return (
    <main className="max-w-[720px] mx-auto px-5 sm:px-6 py-10 sm:py-14">
      <div className="text-[11px] font-semibold tracking-[0.28em] mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
        GUEST LIST
      </div>
      <h1
        className="text-[30px] sm:text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-3"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Your events.
      </h1>
      <p className="text-[14px] leading-[1.6] mb-9" style={{ color: '#8a8a8a' }}>
        Add the names you want on the door. Guests check in under the name you enter here, so use
        the name on their ID.
      </p>

      {upcoming.length === 0 && past.length === 0 ? (
        <div
          className="rounded-[16px] border p-8 sm:p-12 text-center"
          style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <p className="text-[15px] leading-[1.6]" style={{ color: '#a0a0a0' }}>
            No guest list allocations yet — check back closer to your event.
          </p>
          <p className="text-[13px] leading-[1.6] mt-3" style={{ color: '#6a6a6a' }}>
            Spots are set by the Stardust Garage team once your night is confirmed.
          </p>
        </div>
      ) : (
        <>
          {upcoming.length > 0 ? (
            <div className="space-y-4">
              {upcoming.map((grant) => (
                <GrantCard key={grant.id} grant={grant} />
              ))}
            </div>
          ) : (
            <div
              className="rounded-[16px] border p-8 text-center"
              style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}
            >
              <p className="text-[15px]" style={{ color: '#a0a0a0' }}>
                Nothing coming up right now — check back closer to your next event.
              </p>
            </div>
          )}

          {past.length > 0 && (
            // Kept, not hidden: partners look back at who they put on last
            // month's list. Collapsed so it never pushes tonight off the screen.
            <details className="mt-10 group">
              <summary
                className="cursor-pointer list-none text-[12px] font-semibold tracking-[0.14em] py-3 select-none"
                style={{ color: '#8a8a8a' }}
              >
                PAST EVENTS ({past.length})
                <span className="ml-2 inline-block transition-transform group-open:rotate-90">›</span>
              </summary>
              <div className="space-y-4 mt-3 opacity-70">
                {past.map((grant) => (
                  <GrantCard key={grant.id} grant={grant} past />
                ))}
              </div>
            </details>
          )}
        </>
      )}

      <p className="mt-10 text-[13px] leading-[1.6]" style={{ color: '#6a6a6a' }}>
        Need more spots than you were given?{' '}
        <a href="mailto:info@sdgatx.com" style={{ color: '#a0a0a0' }}>
          Ask us
        </a>{' '}
        — allocations are set by the Stardust Garage team.
      </p>
    </main>
  );
}

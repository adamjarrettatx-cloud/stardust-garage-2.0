import { redirect } from 'next/navigation';
import { requirePartner } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import PayBookingCard from './PayBookingCard';

export const revalidate = 0;

// Every booking this artist has ever had, newest first, with the Request Pay
// action folded in. Same shape of page as guest-list/page.js: RPC read
// (partner_bookings(), mirroring partner_grants()) so draft/internal-only
// events an artist is booked for still render a name and date instead of a
// blank row — a partner has no select policy on public.events directly.
export default async function PartnerPayPage() {
  const { unauthorized } = await requirePartner();
  if (unauthorized) redirect('/portal/login');

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('partner_bookings');

  if (error) {
    console.error('[partner pay] partner_bookings failed', error);
  }

  const bookings = (data || []).filter((b) => b.status !== 'cancelled');

  return (
    <main className="max-w-[720px] mx-auto px-5 sm:px-6 py-10 sm:py-14">
      <div className="text-[11px] font-semibold tracking-[0.28em] mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
        PAY
      </div>
      <h1
        className="text-[30px] sm:text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1] mb-3"
        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
      >
        Get paid for your sets.
      </h1>
      <p className="text-[14px] leading-[1.6] mb-9" style={{ color: '#8a8a8a' }}>
        Once your set wraps, Request Pay unlocks 15 minutes after your slot ends. An approved request means
        you&rsquo;re cleared to be paid — we&rsquo;ll follow up separately on how the money actually moves.
      </p>

      {bookings.length === 0 ? (
        <div className="rounded-[16px] border p-8 sm:p-12 text-center" style={{ background: '#141414', borderColor: 'rgba(255,255,255,0.06)' }}>
          <p className="text-[15px] leading-[1.6]" style={{ color: '#a0a0a0' }}>
            No bookings yet — this fills in once you&rsquo;re booked for a set.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map((booking) => (
            <PayBookingCard key={booking.id} booking={booking} />
          ))}
        </div>
      )}
    </main>
  );
}

import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import MemberSignOutButton from './MemberSignOutButton';
import { getTodayInAustin } from '@/lib/studio-helpers';

export const revalidate = 0;

export default async function MemberDashboard() {
  const { user } = await getCurrentUser();

  let displayName = user?.email || 'member';
  let upcomingCount = 0;
  let isActive = false;
  let subscriptionStatus = 'pending';

  try {
    const supabase = await createClient();

    const { data: profile } = await supabase
      .from('member_profiles')
      .select('full_name, is_active, subscription_status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profile?.full_name) {
      displayName = profile.full_name;
    } else if (user.user_metadata?.full_name) {
      displayName = user.user_metadata.full_name;
    }
    isActive = profile?.is_active || false;
    subscriptionStatus = profile?.subscription_status || 'pending';

    if (isActive) {
      const today = getTodayInAustin();
      const { count } = await supabase
        .from('studio_bookings')
        .select('*', { count: 'exact', head: true })
        .eq('member_id', user.id)
        .eq('status', 'confirmed')
        .gte('booking_date', today);
      upcomingCount = count || 0;
    }
  } catch (err) {
    console.error('Member dashboard lookup failed:', err?.message || err);
  }

  return (
    <main className="max-w-[900px] mx-auto px-6 py-16">
      <div className="flex items-center justify-between mb-12">
        <div>
          <div className="text-[11px] font-semibold tracking-[0.28em] mb-3" style={{ color: 'rgba(255,255,255,0.5)' }}>
            MEMBER AREA
          </div>
          <h1 className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
            Welcome, {displayName}.
          </h1>
        </div>
        <MemberSignOutButton />
      </div>

      {!isActive && (
        <div
          className="rounded-[14px] border p-6 mb-8 flex items-center justify-between gap-5"
          style={{ background: '#1f1c14', borderColor: 'rgba(255,200,80,0.3)' }}
        >
          <div>
            <div className="text-[11px] font-semibold tracking-[0.18em] mb-1" style={{ color: '#ffb84d' }}>
              {subscriptionStatus === 'past_due' ? 'PAYMENT FAILED' : 'ACTIVATE YOUR MEMBERSHIP'}
            </div>
            <div className="text-[15px]" style={{ color: '#f5f5f5' }}>
              {subscriptionStatus === 'past_due'
                ? 'Your last payment didn\'t go through. Email us to fix it.'
                : 'Choose a billing plan to unlock studio booking and member benefits.'}
            </div>
          </div>
          {subscriptionStatus !== 'past_due' && (
            <Link
              href="/member/activate"
              className="flex-shrink-0 px-5 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-all hover:-translate-y-0.5"
              style={{ background: '#ffb84d', color: '#0a0a0a' }}
            >
              ACTIVATE
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href={isActive ? '/member/studio' : '#'}
          onClick={(e) => { if (!isActive) e.preventDefault(); }}
          className="relative rounded-[14px] p-7 border transition-all hover:-translate-y-0.5 hover:border-white/15"
          style={{
            background: '#141414',
            borderColor: 'rgba(255,255,255,0.06)',
            opacity: isActive ? 1 : 0.4,
            cursor: isActive ? 'pointer' : 'not-allowed',
          }}
        >
          <div className="text-[10px] font-semibold tracking-[0.18em] mb-3" style={{ color: '#8a8a8a' }}>BOOK</div>
          <div className="text-[20px] font-bold mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>Studio Time</div>
          <p className="text-[13px]" style={{ color: '#8a8a8a' }}>
            {isActive ? 'Reserve studio hours.' : 'Activate membership to book.'}
          </p>
        </Link>

        <Link
          href={isActive ? '/member/bookings' : '#'}
          onClick={(e) => { if (!isActive) e.preventDefault(); }}
          className="relative rounded-[14px] p-7 border transition-all hover:-translate-y-0.5 hover:border-white/15"
          style={{
            background: '#141414',
            borderColor: 'rgba(255,255,255,0.06)',
            opacity: isActive ? 1 : 0.4,
            cursor: isActive ? 'pointer' : 'not-allowed',
          }}
        >
          <div className="text-[10px] font-semibold tracking-[0.18em] mb-3" style={{ color: '#8a8a8a' }}>VIEW</div>
          <div className="text-[20px] font-bold mb-2" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>My Bookings</div>
          <p className="text-[13px]" style={{ color: '#8a8a8a' }}>
            {isActive ? 'Your upcoming studio sessions.' : 'Activate membership to book.'}
          </p>
          {upcomingCount > 0 && (
            <span className="absolute top-4 right-4 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-bold leading-none" style={{ background: '#ffb84d', color: '#0a0a0a', fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
              {upcomingCount}
            </span>
          )}
        </Link>
      </div>

      <div className="mt-12 flex items-center justify-between text-[13px]" style={{ color: '#8a8a8a' }}>
        <div>
          Signed in as <span style={{ color: '#f5f5f5' }}>{user.email}</span>.
        </div>
        <Link href="/member/account" className="underline hover:text-white transition-colors" style={{ color: '#a0a0a0' }}>
          Account settings
        </Link>
      </div>
    </main>
  );
}

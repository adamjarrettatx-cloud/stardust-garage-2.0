import { getCurrentUser } from '@/lib/auth-helpers';
import { createClient } from '@/lib/supabase/server';
import MemberSignOutButton from './MemberSignOutButton';

export const revalidate = 0;

export default async function MemberDashboard() {
  const { user } = await getCurrentUser();

  // Fail-safe profile lookup. If anything goes wrong (table missing, RLS
  // denying access, network error), we don't crash — we just fall back
  // to using the user's email as the display name.
  let displayName = user?.email || 'member';

  try {
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from('member_profiles')
      .select('full_name')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profile?.full_name) {
      displayName = profile.full_name;
    } else if (user.user_metadata?.full_name) {
      displayName = user.user_metadata.full_name;
    }
  } catch (err) {
    // Silently fall back to the default displayName. Logged for visibility.
    console.error('Member profile lookup failed:', err?.message || err);
  }

  return (
    <main className="max-w-[900px] mx-auto px-6 py-16">
      <div className="flex items-center justify-between mb-12">
        <div>
          <div
            className="text-[11px] font-semibold tracking-[0.28em] mb-3"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            MEMBER AREA
          </div>
          <h1
            className="text-[40px] font-extrabold -tracking-[0.02em] leading-[1.1]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Welcome, {displayName}.
          </h1>
        </div>
        <MemberSignOutButton />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          className="relative rounded-[14px] p-7 border"
          style={{
            background: '#141414',
            borderColor: 'rgba(255,255,255,0.05)',
            opacity: 0.6,
          }}
        >
          <div
            className="text-[10px] font-semibold tracking-[0.18em] mb-3"
            style={{ color: '#8a8a8a' }}
          >
            BOOK
          </div>
          <div
            className="text-[20px] font-bold mb-2"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Studio Time
          </div>
          <p className="text-[13px]" style={{ color: '#8a8a8a' }}>
            Reserve studio hours — coming soon.
          </p>
          <span
            className="absolute top-4 right-4 text-[9px] font-semibold tracking-[0.18em] px-2.5 py-1 rounded-full"
            style={{
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.6)',
            }}
          >
            COMING SOON
          </span>
        </div>

        <div
          className="relative rounded-[14px] p-7 border"
          style={{
            background: '#141414',
            borderColor: 'rgba(255,255,255,0.05)',
            opacity: 0.6,
          }}
        >
          <div
            className="text-[10px] font-semibold tracking-[0.18em] mb-3"
            style={{ color: '#8a8a8a' }}
          >
            VIEW
          </div>
          <div
            className="text-[20px] font-bold mb-2"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            My Bookings
          </div>
          <p className="text-[13px]" style={{ color: '#8a8a8a' }}>
            Your upcoming studio sessions — coming soon.
          </p>
          <span
            className="absolute top-4 right-4 text-[9px] font-semibold tracking-[0.18em] px-2.5 py-1 rounded-full"
            style={{
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.6)',
            }}
          >
            COMING SOON
          </span>
        </div>
      </div>

      <p
        className="mt-12 text-[13px] leading-[1.6]"
        style={{ color: '#8a8a8a' }}
      >
        You&apos;re signed in as <span style={{ color: '#f5f5f5' }}>{user.email}</span>.
        Studio booking will be available here once the system is live.
      </p>
    </main>
  );
}

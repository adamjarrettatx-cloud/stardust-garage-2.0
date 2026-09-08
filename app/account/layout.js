// app/account/layout.js
//
// Chrome for every /account/* page. Server component. Responsibilities:
//
//   1. AUTH GATE. /account is the Stardust-account surface \u2014 nothing here
//      is public. Unauthenticated visitors bounce to /login with a `next`
//      param so they come straight back after signing in.
//   2. TAB NAV. Three tabs \u2014 Tickets, Profile, Membership \u2014 rendered as
//      Links so mobile Safari doesn't do the "sluggish button" thing. Active
//      tab is highlighted from the request pathname.
//   3. MOBILE-FIRST LAYOUT. On mobile the tab bar horizontally scrolls under
//      a compact header. On \u2265md screens the tabs stretch into a normal
//      horizontal row inside the shared max-w container.
//
// Deliberately does NOT read /account/tickets data \u2014 each child page owns
// its own fetch. Layout stays a thin shell so a slow tickets query doesn't
// stall the tab bar or the profile page.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/stub';
import { createProfilePhotoSignedUrl } from '@/lib/profile-photo';
import SignOutButton from './SignOutButton';
import ProfileAvatar from '@/components/profile-photo/ProfileAvatar';

const TABS = [
  { href: '/account/tickets', label: 'Tickets' },
  { href: '/account/profile', label: 'Profile' },
  { href: '/account/membership', label: 'Membership' },
];

// Next.js exposes the current pathname to Server Components via a middleware-
// set header (we already have middleware.js, and it forwards x-invoke-path
// / x-pathname on the way through). We read that here so the tab bar knows
// which link is active without every child page having to pass it in.
async function resolvePathname() {
  const h = await headers();
  // Try a few names \u2014 Next has changed the exact header a couple of times
  // and hosts sometimes forward nginx-style names instead.
  return (
    h.get('x-pathname')
    || h.get('x-invoke-path')
    || h.get('next-url')
    || '/account/tickets'
  );
}

export default async function AccountLayout({ children }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    // Bounce with a `next` so /login can send them back after sign-in.
    redirect('/login?next=/account/tickets');
  }

  const pathname = await resolvePathname();

  // Fetch the profile photo (if any) so the signed-in chip shows the
  // user's avatar. This is one lightweight query — running it in the
  // shared layout keeps every /account/* page in sync (upload on one
  // tab reflects on the other after a soft nav / router refresh).
  let avatarSignedUrl = null;
  let displayName = '';
  if (isSupabaseConfigured()) {
    const admin = createAdminClient();
    const { data: fa } = await admin
      .from('free_accounts')
      .select('full_name, profile_photo_path')
      .eq('user_id', user.id)
      .maybeSingle();
    displayName = fa?.full_name || '';
    if (fa?.profile_photo_path) {
      const signed = await createProfilePhotoSignedUrl(admin, fa.profile_photo_path);
      avatarSignedUrl = signed?.signedUrl || null;
    }
  }

  return (
    <main style={{ minHeight: '100vh', background: '#0a0a0a', color: '#f5f5f5' }}>
      <div className="max-w-[1100px] mx-auto px-4 md:px-6 pt-8 md:pt-10 pb-16">
        <div className="mb-5 md:mb-7">
          <div
            className="text-[11px] font-semibold tracking-[0.14em] uppercase mb-2"
            style={{ color: '#8a8a8a' }}
          >
            YOUR ACCOUNT
          </div>
          <h1
            className="text-[28px] md:text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1]"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {TABS.find((t) => pathname.startsWith(t.href))?.label || 'Account'}
          </h1>
          {/* Signed-in-as strip. Prevents the \"why don't my tickets show up?\" *
           * confusion when a user has multiple accounts (Google + password)   *
           * and lands on /account/tickets under the wrong one. Making the     *
           * signed-in email visible + one-click sign out means the mismatch   *
           * is obvious instead of invisible.                                  */}
          <div
            className="mt-3 flex items-center justify-between gap-3 flex-wrap"
            style={{ fontSize: 12, color: '#8a8a8a' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <ProfileAvatar
                src={avatarSignedUrl}
                nameOrEmail={displayName || user.email || ''}
                size={32}
              />
              <div>
                {'Signed in as '}
                <span style={{ color: '#e0e0e0' }}>{user.email}</span>
              </div>
            </div>
            <SignOutButton />
          </div>
        </div>

        {/* Tab bar. Horizontal scroll on mobile so long labels never wrap
            or truncate; regular row on md+. */}
        <nav
          aria-label="Account sections"
          className="mb-6 md:mb-8 -mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto"
        >
          <ul
            className="flex gap-2 md:gap-3 pb-2 md:pb-0"
            style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
          >
            {TABS.map((tab) => {
              const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <li key={tab.href} className="flex-shrink-0">
                  <Link
                    href={tab.href}
                    className="inline-block px-4 md:px-5 py-2.5 md:py-3 text-[13px] md:text-[14px] font-semibold tracking-[0.04em] transition-colors"
                    style={{
                      color: active ? '#f5f5f5' : '#8a8a8a',
                      borderBottom: active ? '2px solid #f5f5f5' : '2px solid transparent',
                      marginBottom: -1,
                    }}
                  >
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {children}
      </div>
    </main>
  );
}

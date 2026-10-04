'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Site-wide "Member Login" button at the bottom of every public page.
//
// Hidden where it would be redundant or out of place:
//   - signed-in visitors (they're already logged in)
//   - the login / password pages themselves
//   - /home, whose full SiteFooter already lists Member Login
//   - signed-in areas and staff/kiosk/door surfaces
const HIDDEN_PREFIXES = [
  '/login', '/forgot-password', '/reset-password', '/auth',
  '/home',
  '/account', '/member/', '/portal', '/notifications',
  '/bananas', '/team', '/capacity', '/clock', '/staff', '/employee',
  '/door', '/scan', '/t/scan', '/handoff',
];

function isHidden(pathname) {
  if (!pathname) return true;
  if (pathname === '/member') return true;
  return HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : `${p}/`));
}

export default function MemberLoginFooter() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSignedIn(Boolean(data?.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
    });
    return () => {
      active = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  // Wait for the session check so signed-in visitors never see a flash.
  if (signedIn !== false || isHidden(pathname)) return null;

  return (
    <footer
      className="relative z-10 flex justify-center px-6 pt-10 pb-12 border-t"
      style={{ borderColor: 'rgba(255,255,255,0.06)' }}
    >
      <Link
        href="/login"
        className="inline-flex items-center justify-center px-7 py-3 rounded-full border text-[12px] font-semibold tracking-[0.16em] transition-colors hover:bg-white/[0.06]"
        style={{ borderColor: 'rgba(255,255,255,0.18)', color: '#f5f5f5', fontFamily: "'Inter', sans-serif" }}
      >
        MEMBER LOGIN
      </Link>
    </footer>
  );
}

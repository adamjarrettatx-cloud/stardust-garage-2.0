'use client';

import { usePathname } from 'next/navigation';

export default function NavbarVisibility({ children }) {
  const pathname = usePathname();
  if (pathname === '/door') return null;
  if (pathname === '/staff' || pathname.startsWith('/staff/')) return null;
  if (pathname === '/employee' || pathname.startsWith('/employee/')) return null;

  // Hide navbar on the splash page (root /) and on the full-screen capacity
  // counter pages (the two Jelly2 door stations) so they stay chrome-free with
  // maximal tap targets.
  if (pathname === '/' || pathname === '/members' || pathname === '/clock' || pathname.startsWith('/clock/') || pathname.startsWith('/capacity')) {
    return null;
  }

  return children;
}

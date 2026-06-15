'use client';

import { usePathname } from 'next/navigation';

export default function NavbarVisibility({ children }) {
  const pathname = usePathname();

  // Hide navbar on the splash page (root /) and on the full-screen capacity
  // counter pages (the two Jelly2 door stations) so they stay chrome-free with
  // maximal tap targets.
  if (pathname === '/' || pathname.startsWith('/capacity')) {
    return null;
  }

  return children;
}

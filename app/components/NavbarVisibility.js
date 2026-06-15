'use client';

import { usePathname } from 'next/navigation';

export default function NavbarVisibility({ children }) {
  const pathname = usePathname();

  // Hide navbar on the splash page (root /) and on the full-screen capacity
  // counter pages (Jelly2 door stations + Raspberry Pi display) so they stay
  // chrome-free with maximal tap targets.
  if (pathname === '/' || pathname.startsWith('/capacity')) {
    return null;
  }

  return children;
}

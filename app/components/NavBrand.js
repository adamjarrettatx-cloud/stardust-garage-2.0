'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Wordmark from './Wordmark';

export default function NavBrand({ logoUrl }) {
  const pathname = usePathname();

  // Show logo image only on the homepage (/home), Wordmark text elsewhere.
  const showLogo = pathname === '/home' && logoUrl;

  return (
    <Link
      href="/home"
      className="flex items-center"
      aria-label="Stardust Garage home"
    >
      {showLogo ? (
        <img
          src={logoUrl}
          alt="Stardust Garage"
          className="h-10 w-auto object-contain"
        />
      ) : (
        <Wordmark size="sm" />
      )}
    </Link>
  );
}

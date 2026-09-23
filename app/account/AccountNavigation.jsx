'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/account/tickets', label: 'Tickets' },
  { href: '/account/profile', label: 'Profile' },
  { href: '/account/membership', label: 'Membership' },
];

function isActive(pathname, href) {
  return pathname === href || pathname?.startsWith(`${href}/`);
}

// Shared server layouts persist during client navigation. Read the live
// pathname here rather than relying on request headers from the initial load.
export function AccountHeading() {
  const pathname = usePathname();
  return (
    <h1
      className="text-[28px] md:text-[32px] font-extrabold -tracking-[0.02em] leading-[1.1]"
      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      {TABS.find((tab) => isActive(pathname, tab.href))?.label || 'Account'}
    </h1>
  );
}

export default function AccountNavigation() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Account sections"
      className="mb-6 md:mb-8 -mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto"
    >
      <ul
        className="flex gap-2 md:gap-3 pb-2 md:pb-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <li key={tab.href} className="flex-shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
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
  );
}

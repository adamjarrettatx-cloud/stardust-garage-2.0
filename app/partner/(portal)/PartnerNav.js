'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PartnerSignOutButton from '../PartnerSignOutButton';

// Two destinations, and that is the whole product for a partner. Promoters and
// collectives open this on a phone in a green room ten minutes before doors, so
// the bar is sticky and the tap targets are large; there is no hamburger to
// find and nothing to scroll past.
//
// Deliberately no brand mark here: the root layout already renders the site
// navbar on /partner routes, so a logo in this bar would be the second one on
// the page.
const TABS = [
  { href: '/partner/guest-list', label: 'Guest List' },
  { href: '/partner/pay', label: 'Pay' },
  { href: '/partner/profile', label: 'My Profile' },
];

export default function PartnerNav() {
  const pathname = usePathname();

  return (
    <div
      className="sticky top-0 z-40 backdrop-blur mt-6"
      style={{ background: 'rgba(10,10,10,0.85)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="max-w-[720px] mx-auto px-5 sm:px-6 flex flex-wrap items-center justify-between gap-3 py-3">
        <nav className="flex gap-2">
          {TABS.map((tab) => {
            // startsWith so /partner/guest-list/<grantId> keeps the tab lit.
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className="px-4 py-2.5 rounded-full text-[12px] font-semibold tracking-[0.14em] transition-colors"
                style={
                  active
                    ? { background: '#ffffff', color: '#0a0a0a' }
                    : { color: '#8a8a8a', border: '1px solid rgba(255,255,255,0.1)' }
                }
              >
                {tab.label.toUpperCase()}
              </Link>
            );
          })}
        </nav>

        <PartnerSignOutButton />
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import PortalSignOutButton from '../PortalSignOutButton';
import { canHostGuestList, canRequestPay, portalName } from '@/lib/role-label';

// Two destinations, and that is the whole product for a partner. Promoters and
// collectives open this on a phone in a green room ten minutes before doors, so
// the bar is sticky and the tap targets are large; there is no hamburger to
// find and nothing to scroll past.
//
// Deliberately no brand mark here: the root layout already renders the site
// navbar on /partner routes, so a logo in this bar would be the second one on
// the page.
const ALL_TABS = [
  { href: '/portal/guest-list', label: 'Guest List', show: canHostGuestList },
  { href: '/portal/pay', label: 'Pay', show: canRequestPay },
  { href: '/portal/profile', label: 'My Profile', show: () => true },
];

export default function PortalNav({ contactType }) {
  const pathname = usePathname();
  const tabs = ALL_TABS.filter((t) => t.show(contactType));
  const name = portalName(contactType);

  return (
    <div
      className="sticky top-0 z-40 backdrop-blur mt-6"
      style={{ background: 'rgba(10,10,10,0.85)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="max-w-[720px] mx-auto px-5 sm:px-6 flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="text-[11px] font-semibold tracking-[0.24em] uppercase" style={{ color: '#8a8a8a' }}>
          {name}
        </div>
        <nav className="flex gap-2">
          {tabs.map((tab) => {
            // startsWith so /portal/guest-list/<grantId> keeps the tab lit.
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

        <PortalSignOutButton />
      </div>
    </div>
  );
}

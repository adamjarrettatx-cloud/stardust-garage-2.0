'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { portalName } from '@/lib/role-label';

const TABS = [
  { href: '/account/profile', label: 'Profile' },
  { href: '/portal/guest-list', label: 'Guest list', key: 'guestList' },
  { href: '/portal/pay', label: 'Bookings & pay', key: 'pay' },
  { href: '/portal/contracts', label: 'Contracts', key: 'contracts' },
];

export default function PortalNav({ contactType, views = {} }) {
  const pathname = usePathname();
  const router = useRouter();
  const tabs = TABS.filter((tab) => !tab.key || views[tab.key]);
  const active = tabs.find((tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`))?.href || '';
  return <div className="portal-section-navigation">
    <span style={{ color: '#aaa7a0', fontSize: 12 }}>{portalName(contactType)}</span>
    <nav aria-label="Partner sections">{tabs.map((tab) => <Link key={tab.href} href={tab.href} aria-current={active === tab.href ? 'page' : undefined}>{tab.label}</Link>)}</nav>
    <select aria-label="Partner workspace menu" value={active} onChange={(event) => {
      if (tabs.some((tab) => tab.href === event.target.value)) router.push(event.target.value);
    }}>
      {!active && <option value="" disabled>Choose a section</option>}
      {tabs.map((tab) => <option key={tab.href} value={tab.href}>{tab.label}</option>)}
    </select>
  </div>;
}

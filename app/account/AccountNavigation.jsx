'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export const ACCOUNT_SECTIONS = [
  { href: '/account/profile', label: 'Profile' },
  { href: '/account/tickets', label: 'Tickets' },
  { href: '/account/membership', label: 'Membership & access', heading: 'Membership' },
  { href: '/account/security', label: 'Login & security' },
];
const isActive = (pathname, href) => pathname === href || pathname?.startsWith(`${href}/`);

export function AccountHeading() {
  const pathname = usePathname();
  const section = ACCOUNT_SECTIONS.find((item) => isActive(pathname, item.href));
  return <h1>{section?.heading || section?.label || 'Account'}</h1>;
}

export default function AccountNavigation({ workspaces = [] }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = [...ACCOUNT_SECTIONS, ...workspaces];
  const current = items.find((item) => isActive(pathname, item.href))?.href || '';
  return <div className="account-hub-navigation">
    <div className="account-hub-mobile-menu">
      <label htmlFor="account-section">Profile menu</label>
      <select id="account-section" value={current} onChange={(event) => {
        if (items.some((item) => item.href === event.target.value)) router.push(event.target.value);
      }}>
        {!current && <option value="" disabled>Choose a section</option>}
        <optgroup label="Account">{ACCOUNT_SECTIONS.map((item) => <option key={item.href} value={item.href}>{item.label}</option>)}</optgroup>
        {workspaces.length > 0 && <optgroup label="Workspace">{workspaces.map((item) => <option key={item.href} value={item.href}>{item.label}</option>)}</optgroup>}
      </select>
    </div>
    <nav className="account-hub-sidebar" aria-label="Account sections">
      {[{ label: 'Account', items: ACCOUNT_SECTIONS }, { label: 'Workspace', items: workspaces }].filter((group) => group.items.length).map((group) =>
        <div key={group.label}><p className="account-hub-nav-label">{group.label}</p><ul>{group.items.map((item) =>
          <li key={item.href}><Link href={item.href} aria-current={isActive(pathname, item.href) ? 'page' : undefined}>{item.label}</Link></li>
        )}</ul></div>
      )}
    </nav>
  </div>;
}

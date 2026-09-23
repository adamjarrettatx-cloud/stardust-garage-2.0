import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ pathname: '/account/profile' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('next/link', () => ({
  default: ({ children, ...props }) => React.createElement('a', props, children),
}));

import AccountNavigation, { AccountHeading } from '../../app/account/AccountNavigation';

describe('account route chrome', () => {
  it.each([
    ['/account/tickets', 'Tickets'],
    ['/account/profile', 'Profile'],
    ['/account/membership', 'Membership'],
    ['/account/tickets/example', 'Tickets'],
  ])('renders the correct heading and active tab for %s', (pathname, label) => {
    route.pathname = pathname;
    expect(renderToStaticMarkup(React.createElement(AccountHeading))).toContain(`>${label}</h1>`);
    const nav = renderToStaticMarkup(React.createElement(AccountNavigation));
    expect(nav.match(/aria-current="page"/g)).toHaveLength(1);
    expect(nav).toMatch(new RegExp(`aria-current="page"[^>]*>${label}</a>`));
  });

  it('updates when the current pathname changes', () => {
    for (const label of ['Profile', 'Tickets', 'Membership', 'Profile']) {
      route.pathname = `/account/${label.toLowerCase()}`;
      expect(renderToStaticMarkup(React.createElement(AccountHeading))).toContain(`>${label}</h1>`);
    }
  });

  it.each(['/account/profile-other', '/account', null])('does not falsely select a tab for %s', (pathname) => {
    route.pathname = pathname;
    expect(renderToStaticMarkup(React.createElement(AccountHeading))).toContain('>Account</h1>');
    expect(renderToStaticMarkup(React.createElement(AccountNavigation))).not.toContain('aria-current');
  });
});

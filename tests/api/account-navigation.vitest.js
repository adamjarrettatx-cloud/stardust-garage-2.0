import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('next/link', () => ({
  default: ({ children, ...props }) => React.createElement('a', props, children),
}));
import AccountNavigation from '../../app/account/AccountNavigation';

describe('profile workspace navigation', () => {
  it('renders nothing for accounts without a workspace', () => {
    expect(renderToStaticMarkup(React.createElement(AccountNavigation))).toBe('');
  });
  it('renders only supplied role-authorized workspaces', () => {
    const markup = renderToStaticMarkup(React.createElement(AccountNavigation, { workspaces: [
      { href: '/capacity/front-desk', label: 'Front desk' },
    ] }));
    expect(markup).toContain('href="/capacity/front-desk"');
    expect(markup).not.toContain('/bananas');
    expect(markup).not.toContain('/portal/');
  });
  it('has no profile menu, tickets tab, or standalone settings links', () => {
    const markup = renderToStaticMarkup(React.createElement(AccountNavigation, { workspaces: [
      { href: '/member', label: 'Member dashboard' },
    ] }));
    for (const forbidden of ['<select', 'Profile menu', '/account/tickets', '/account/membership', '/account/security']) {
      expect(markup).not.toContain(forbidden);
    }
  });
});

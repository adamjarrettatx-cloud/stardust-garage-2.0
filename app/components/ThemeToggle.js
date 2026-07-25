'use client';

import { createElement } from 'react';

// Shared pill-style light/dark toggle. The caller owns theme state so the
// control stays reusable across authenticated pages and shells.
export default function ThemeToggle({
  theme,
  onToggle,
  className = '',
  dataTestId = 'theme-toggle-button',
}) {
  const isLight = theme === 'light';
  const label = isLight ? 'Switch to dark mode' : 'Switch to light mode';

  const icon = isLight
    ? createElement(
        'svg',
        {
          width: '13',
          height: '13',
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: '#f59e0b',
          strokeWidth: '2.2',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        createElement('circle', { cx: '12', cy: '12', r: '4.5' }),
        createElement('path', { d: 'M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8' })
      )
    : createElement(
        'svg',
        {
          width: '13',
          height: '13',
          viewBox: '0 0 24 24',
          fill: '#ffb84d',
          stroke: 'none',
        },
        createElement('path', { d: 'M20.4 14.7A8.8 8.8 0 0 1 9.3 3.6a.6.6 0 0 0-.7-.85A10 10 0 1 0 21.25 15.4a.6.6 0 0 0-.85-.7Z' })
      );

  return createElement(
    'button',
    {
      type: 'button',
      onClick: onToggle,
      'aria-label': label,
      title: label,
      className,
      'data-testid': dataTestId,
      style: {
        position: 'relative',
        width: '52px',
        height: '28px',
        borderRadius: '999px',
        border: isLight ? '1px solid rgba(0,0,0,0.18)' : '1px solid rgba(255,255,255,0.12)',
        background: isLight ? '#efece6' : 'rgba(255,255,255,0.06)',
        padding: '2px',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        transition: 'background 0.2s ease, border-color 0.2s ease',
      },
    },
    createElement(
      'span',
      {
        style: {
          position: 'absolute',
          top: '2px',
          left: isLight ? '26px' : '2px',
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          background: isLight ? '#ffffff' : '#0a0a0a',
          boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'left 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), background 0.2s ease',
        },
      },
      icon
    )
  );
}

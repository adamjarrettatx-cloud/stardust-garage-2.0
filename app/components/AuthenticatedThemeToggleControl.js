'use client';

import { createElement } from 'react';
import ThemeToggle from './ThemeToggle.js';

const MODE_TEST_IDS = {
  shell: 'auth-theme-toggle-shell',
  inline: 'auth-theme-toggle-inline',
};

export default function AuthenticatedThemeToggleControl({
  theme,
  onToggle,
  mode = 'inline',
  className = '',
}) {
  if (mode === 'none') return null;

  return createElement(
    'div',
    {
      className: className.trim(),
      'data-testid': MODE_TEST_IDS[mode] || MODE_TEST_IDS.inline,
      'data-theme-toggle-mode': mode,
    },
    createElement(ThemeToggle, {
      theme,
      onToggle,
      dataTestId: 'theme-toggle-button',
    })
  );
}

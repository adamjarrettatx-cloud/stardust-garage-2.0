'use client';

import { createElement } from 'react';
import ThemeToggle from './ThemeToggle.js';

const INLINE_TEST_ID = 'auth-theme-toggle-inline';

export default function AuthenticatedThemeToggleControl({
  theme,
  onToggle,
  mode = 'inline',
  className = '',
  testId,
}) {
  if (mode === 'none') return null;

  return createElement(
    'div',
    {
      className: className.trim(),
      'data-testid': testId || INLINE_TEST_ID,
      'data-theme-toggle-mode': mode,
    },
    createElement(ThemeToggle, {
      theme,
      onToggle,
      dataTestId: 'theme-toggle-button',
    })
  );
}

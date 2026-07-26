'use client';

import AuthenticatedThemeToggleControl from './AuthenticatedThemeToggleControl';
import { useAuthenticatedTheme } from './AuthenticatedThemeProvider';

export default function AuthenticatedPageThemeToggle({ className = 'flex items-center flex-shrink-0' }) {
  const { theme, toggleTheme } = useAuthenticatedTheme();

  return (
    <AuthenticatedThemeToggleControl
      theme={theme}
      onToggle={toggleTheme}
      mode="inline"
      className={className}
    />
  );
}

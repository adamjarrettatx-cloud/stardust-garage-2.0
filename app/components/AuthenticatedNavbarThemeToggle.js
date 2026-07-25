'use client';

import { usePathname } from 'next/navigation';
import AuthenticatedThemeToggleControl from './AuthenticatedThemeToggleControl.js';
import { useOptionalAuthenticatedTheme } from './AuthenticatedThemeProvider.js';
import { resolveAuthenticatedThemeToggleMode } from '@/lib/authenticated-theme';

export default function AuthenticatedNavbarThemeToggle() {
  const pathname = usePathname();
  const authTheme = useOptionalAuthenticatedTheme();

  if (!authTheme) return null;
  if (resolveAuthenticatedThemeToggleMode(pathname) !== 'shell') return null;

  return (
    <AuthenticatedThemeToggleControl
      theme={authTheme.theme}
      onToggle={authTheme.toggleTheme}
      mode="shell"
      className="flex items-center flex-shrink-0"
    />
  );
}

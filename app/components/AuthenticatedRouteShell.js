'use client';

import { usePathname } from 'next/navigation';
import AuthenticatedThemeProvider from './AuthenticatedThemeProvider';
import { resolveAuthenticatedThemeScope } from '@/lib/authenticated-theme';

export default function AuthenticatedRouteShell({ children }) {
  const pathname = usePathname();
  const scope = resolveAuthenticatedThemeScope(pathname);

  if (!scope) return children;

  return <AuthenticatedThemeProvider scope={scope}>{children}</AuthenticatedThemeProvider>;
}

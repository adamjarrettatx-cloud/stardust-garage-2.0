'use client';

import { usePathname } from 'next/navigation';
import AuthenticatedThemeProvider from './AuthenticatedThemeProvider';
import { resolveAuthenticatedThemeScope } from '@/lib/authenticated-theme';

export default function AuthenticatedRouteShell({ navbar = null, children }) {
  const pathname = usePathname();
  const scope = resolveAuthenticatedThemeScope(pathname);

  if (!scope) {
    return (
      <div className="relative z-10">
        {navbar}
        {children}
      </div>
    );
  }

  return (
    <AuthenticatedThemeProvider scope={scope}>
      <div className="relative z-10">
        {navbar}
        <div className="auth-theme-frame-shell">
          <div
            className="auth-theme-frame"
            data-auth-theme-frame="true"
            data-testid="auth-theme-content-frame"
          >
            {children}
          </div>
        </div>
      </div>
    </AuthenticatedThemeProvider>
  );
}

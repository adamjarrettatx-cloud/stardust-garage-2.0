'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import ThemeToggle from './ThemeToggle';
import {
  AUTH_THEME_STORAGE_KEYS,
  AUTH_THEMES,
  resolveAuthTheme,
  authThemeVars,
  shouldUseInlineAuthenticatedThemeToggle,
} from '@/lib/authenticated-theme';

const AuthenticatedThemeContext = createContext(null);

function ThemeFloat({ theme, onToggle }) {
  return (
    <div
      className="fixed z-50"
      style={{
        top: 'max(20px, env(safe-area-inset-top))',
        right: 'max(20px, env(safe-area-inset-right))',
      }}
    >
      <div
        className="rounded-full px-2 py-2 backdrop-blur-sm"
        style={{
          background: 'color-mix(in srgb, var(--auth-panel-bg) 92%, transparent)',
          border: '1px solid var(--auth-card-border-strong)',
          boxShadow: theme === 'light' ? '0 12px 32px rgba(0,0,0,0.14)' : '0 12px 32px rgba(0,0,0,0.28)',
        }}
      >
        <ThemeToggle theme={theme} onToggle={onToggle} />
      </div>
    </div>
  );
}

export default function AuthenticatedThemeProvider({ scope, children }) {
  const pathname = usePathname();
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    const key = AUTH_THEME_STORAGE_KEYS[scope];
    try {
      setTheme(resolveAuthTheme(window.localStorage.getItem(key)));
    } catch {
      setTheme('dark');
    }
  }, [scope]);

  const toggleTheme = useCallback(() => {
    const key = AUTH_THEME_STORAGE_KEYS[scope];
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // localStorage unavailable — keep the in-memory theme only.
      }
      return next;
    });
  }, [scope]);

  const value = useMemo(() => ({
    scope,
    theme,
    toggleTheme,
    t: AUTH_THEMES[theme],
  }), [scope, theme, toggleTheme]);

  const showFloatingToggle = !shouldUseInlineAuthenticatedThemeToggle(pathname);

  return (
    <AuthenticatedThemeContext.Provider value={value}>
      <div
        className="auth-theme-root min-h-screen"
        data-auth-scope={scope}
        data-auth-theme={theme}
        style={authThemeVars(theme)}
      >
        {showFloatingToggle ? <ThemeFloat theme={theme} onToggle={toggleTheme} /> : null}
        {children}
      </div>
    </AuthenticatedThemeContext.Provider>
  );
}

export function useAuthenticatedTheme() {
  const value = useContext(AuthenticatedThemeContext);
  if (!value) {
    throw new Error('useAuthenticatedTheme must be used within AuthenticatedThemeProvider.');
  }
  return value;
}

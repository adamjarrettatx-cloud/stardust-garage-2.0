'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  AUTH_THEME_STORAGE_KEYS,
  AUTH_THEMES,
  resolveAuthTheme,
  authThemeVars,
} from '@/lib/authenticated-theme';

const AuthenticatedThemeContext = createContext(null);

export default function AuthenticatedThemeProvider({ scope, children }) {
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    const key = AUTH_THEME_STORAGE_KEYS[scope];
    try {
      setTheme(resolveAuthTheme(window.localStorage.getItem(key)));
    } catch {
      setTheme('dark');
    }
  }, [scope]);

  useEffect(() => {
    document.documentElement.setAttribute('data-auth-scope', scope);
    document.documentElement.setAttribute('data-auth-theme', theme);
    document.body.setAttribute('data-auth-scope', scope);
    document.body.setAttribute('data-auth-theme', theme);

    return () => {
      document.documentElement.removeAttribute('data-auth-scope');
      document.documentElement.removeAttribute('data-auth-theme');
      document.body.removeAttribute('data-auth-scope');
      document.body.removeAttribute('data-auth-theme');
    };
  }, [scope, theme]);

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

  return (
    <AuthenticatedThemeContext.Provider value={value}>
      <div
        className="auth-theme-root min-h-screen"
        data-auth-scope={scope}
        data-auth-theme={theme}
        style={authThemeVars(theme)}
      >
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

export function useOptionalAuthenticatedTheme() {
  return useContext(AuthenticatedThemeContext);
}

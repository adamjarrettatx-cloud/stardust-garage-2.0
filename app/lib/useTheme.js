'use client';

import { useCallback, useEffect, useState } from 'react';

export const THEME_STORAGE_KEY = 'sdg-theme';
const THEME_CHANGE_EVENT = 'sdg-theme-change';

function readCurrentTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/**
 * Shared site-wide theme hook. Any component can call this to read the
 * current theme reactively; only the ThemeToggle in the navbar calls
 * `setTheme`, but every consumer (e.g. the admin Team Calendar) stays in
 * sync via a custom window event + storage event, so there is exactly one
 * source of truth: the `data-theme` attribute on <html> + localStorage.
 */
export function useTheme() {
  // Always default to 'dark' on the initial render so the client's
  // hydration pass matches the server-rendered markup exactly (the
  // server has no access to localStorage/DOM). The inline no-flash
  // script in layout.js already set the correct `data-theme` attribute
  // on <html> before hydration runs; we pick that real value up in the
  // effect below, which fires *after* hydration commits, so it can
  // never cause a hydration mismatch.
  const [theme, setThemeState] = useState('dark');

  useEffect(() => {
    setThemeState(readCurrentTheme());

    const handleChange = () => setThemeState(readCurrentTheme());
    window.addEventListener(THEME_CHANGE_EVENT, handleChange);
    window.addEventListener('storage', handleChange);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, handleChange);
      window.removeEventListener('storage', handleChange);
    };
  }, []);

  const setTheme = useCallback((next) => {
    const resolved = next === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', resolved);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, resolved);
    } catch (e) {
      // ignore (private browsing / storage disabled)
    }
    setThemeState(resolved);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(readCurrentTheme() === 'light' ? 'dark' : 'light');
  }, [setTheme]);

  return { theme, setTheme, toggleTheme };
}

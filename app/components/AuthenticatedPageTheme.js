'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import AuthenticatedThemeToggleControl from './AuthenticatedThemeToggleControl';
import { useAuthenticatedTheme } from './AuthenticatedThemeProvider';

function palette(scope, theme) {
  if (theme === 'dark') {
    return {
      pageBg: 'transparent',
      panelBg: null,
      panelShadow: 'none',
      label: scope === 'team' ? '← TEAM' : '← BACK TO ADMIN',
      titleColor: 'var(--auth-text-strong)',
      subtitleColor: 'var(--auth-muted)',
    };
  }

  return {
    pageBg: 'var(--auth-root-bg)',
    panelBg: 'var(--auth-panel-bg)',
    panelShadow: 'var(--auth-panel-shadow)',
    label: scope === 'team' ? '← TEAM' : '← BACK TO ADMIN',
    titleColor: 'var(--auth-text-strong)',
    subtitleColor: 'var(--auth-muted)',
  };
}

export function useAuthenticatedPageTheme(scope = 'admin') {
  const { theme, toggleTheme, t } = useAuthenticatedTheme();
  const page = useMemo(() => palette(scope, theme), [scope, theme]);

  return {
    theme,
    toggleTheme,
    t,
    page,
  };
}

export function AuthenticatedInlineThemeToggle({
  className = '',
  testId = 'auth-theme-toggle-inline',
}) {
  const { theme, toggleTheme } = useAuthenticatedTheme();

  return (
    <AuthenticatedThemeToggleControl
      theme={theme}
      onToggle={toggleTheme}
      mode="inline"
      className={className}
      testId={testId}
    />
  );
}

export function AuthenticatedPageSurface({
  scope = 'admin',
  width = 'max-w-[1100px]',
  className = '',
  children,
  testId,
}) {
  const { page } = useAuthenticatedPageTheme(scope);
  const classes = ['auth-theme-page', width, 'mx-auto', 'px-6', 'py-16'];

  if (page.panelBg) {
    classes.push('my-6', 'md:my-10', 'rounded-[28px]');
  }
  if (className) classes.push(className);

  return (
    <main
      className={classes.join(' ')}
      style={{
        background: page.panelBg || page.pageBg,
        boxShadow: page.panelShadow,
        color: 'var(--auth-text)',
      }}
      data-testid={testId}
    >
      {children}
    </main>
  );
}

export function AuthenticatedPageHeader({
  backHref,
  backLabel,
  title,
  subtitle,
  scope = 'admin',
  titleTestId,
  right = null,
  titleClassName = 'text-[32px]',
  subtitleClassName = 'text-[14px]',
}) {
  const { page } = useAuthenticatedPageTheme(scope);
  const defaultLabel = scope === 'team' ? page.label : page.label;

  return (
    <>
      {backHref && (
        <Link
          href={backHref}
          className="auth-theme-page-link inline-block text-[12px] font-semibold tracking-[0.14em] mb-4 transition-colors"
        >
          {backLabel || defaultLabel}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div className="min-w-0 flex-1">
          <h1
            className={`${titleClassName} font-extrabold -tracking-[0.02em] leading-[1.1]`}
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", color: page.titleColor }}
            data-testid={titleTestId}
          >
            {title}
          </h1>
          {subtitle ? (
            <p className={`${subtitleClassName} mt-2`} style={{ color: page.subtitleColor }}>
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {right}
          <AuthenticatedInlineThemeToggle />
        </div>
      </div>
    </>
  );
}

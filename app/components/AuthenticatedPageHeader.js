'use client';

import Link from 'next/link';
import AuthenticatedPageThemeToggle from './AuthenticatedPageThemeToggle';

const DEFAULT_TITLE_STYLE = {
  fontFamily: "'Plus Jakarta Sans', sans-serif",
  color: 'var(--auth-text-strong)',
};

const DEFAULT_MUTED_STYLE = {
  color: 'var(--auth-muted)',
};

export default function AuthenticatedPageHeader({
  backHref = null,
  backLabel = null,
  title,
  description = null,
  eyebrow = null,
  children = null,
  className = 'mb-8',
  titleClassName = 'text-[36px] font-extrabold -tracking-[0.02em] leading-[1.1]',
  descriptionClassName = 'text-[14px]',
  rowClassName = 'flex flex-wrap items-center justify-between gap-4 mb-2',
  actionsClassName = 'flex flex-wrap items-center gap-3',
  titleStyle = null,
  descriptionStyle = null,
  eyebrowStyle = null,
  // Pages rendered inside the admin shell already inherit the shell header's
  // toggle, so they opt out here instead of putting two identical switches on
  // the same screen. See tests/single-theme-toggle.test.mjs.
  showThemeToggle = true,
}) {
  return (
    <div className={className} data-testid="auth-page-header">
      {backHref && backLabel ? (
        <Link
          href={backHref}
          className="auth-theme-page-link inline-block text-[12px] font-semibold tracking-[0.14em] mb-4 transition-colors"
        >
          {backLabel}
        </Link>
      ) : null}

      <div className={rowClassName}>
        <h1 className={titleClassName} style={titleStyle ? { ...DEFAULT_TITLE_STYLE, ...titleStyle } : DEFAULT_TITLE_STYLE}>
          {title}
        </h1>

        <div className={actionsClassName} data-testid="auth-page-header-actions">
          {eyebrow ? (
            <div
              className="text-[11px] tracking-[0.18em]"
              style={eyebrowStyle ? { ...DEFAULT_MUTED_STYLE, ...eyebrowStyle } : DEFAULT_MUTED_STYLE}
            >
              {eyebrow}
            </div>
          ) : null}
          {showThemeToggle ? <AuthenticatedPageThemeToggle /> : null}
          {children}
        </div>
      </div>

      {description ? (
        <p
          className={descriptionClassName}
          style={descriptionStyle ? { ...DEFAULT_MUTED_STYLE, ...descriptionStyle } : DEFAULT_MUTED_STYLE}
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}

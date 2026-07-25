import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AuthenticatedThemeToggleControl from '../app/components/AuthenticatedThemeToggleControl.js';
import {
  AUTH_THEME_INLINE_TOGGLE_PATHS,
  authThemeVars,
  resolveAuthenticatedThemeToggleMode,
} from '../lib/authenticated-theme.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function listPageRoutes(base, prefix) {
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === 'page.js') {
        files.push(full);
      }
    }
  }

  walk(base);

  return files
    .map((file) => {
      const rel = path.relative(base, path.dirname(file)).split(path.sep).join('/');
      return rel ? `${prefix}/${rel}` : prefix;
    })
    .sort();
}

function renderToggleMarkupForRoute(route, theme = 'dark') {
  const mode = resolveAuthenticatedThemeToggleMode(route);
  if (mode === 'none') return '';
  return renderToStaticMarkup(
    createElement(AuthenticatedThemeToggleControl, {
      theme,
      onToggle: () => {},
      mode,
    }),
  );
}

const adminRoutes = listPageRoutes(path.join(REPO_ROOT, 'app/bananas'), '/bananas').filter(
  (route) => route !== '/bananas/login',
);
const teamRoutes = listPageRoutes(path.join(REPO_ROOT, 'app/team'), '/team').filter(
  (route) => route !== '/team/login',
);
const authenticatedRoutes = [...adminRoutes, ...teamRoutes].sort();
const redirectRoutes = new Map([
  ['/bananas/calendar', '/team/calendar'],
  ['/bananas/progress', '/team/progress'],
]);
const domRoutes = authenticatedRoutes.filter((route) => !redirectRoutes.has(route)).sort();
const inlineRoutes = [...AUTH_THEME_INLINE_TOGGLE_PATHS].sort();
const shellRoutes = domRoutes.filter((route) => !inlineRoutes.includes(route)).sort();

test('authenticated toggle route matrix covers every current DOM-serving admin/team route exactly once', () => {
  const actualInline = domRoutes
    .filter((route) => resolveAuthenticatedThemeToggleMode(route) === 'inline')
    .sort();
  const actualShell = domRoutes
    .filter((route) => resolveAuthenticatedThemeToggleMode(route) === 'shell')
    .sort();

  assert.deepEqual(actualInline, inlineRoutes);
  assert.deepEqual(actualShell, shellRoutes);
  assert.equal(actualInline.length + actualShell.length, domRoutes.length);
});

test('authenticated redirect aliases point only to already-themed routes with their own visible toggles', () => {
  for (const [route, target] of redirectRoutes) {
    const relativePath = `app${route}/page.js`.replace(/\[(.+?)\]/g, '[$1]');
    const content = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.match(content, new RegExp(`redirect\\('${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`));
    assert.notEqual(resolveAuthenticatedThemeToggleMode(target), 'none');
  }
});

test('every DOM-serving authenticated route resolves to visible toggle markup', () => {
  for (const route of domRoutes) {
    const mode = resolveAuthenticatedThemeToggleMode(route);
    const markup = renderToggleMarkupForRoute(route);
    const expectedTestId = mode === 'inline' ? 'auth-theme-toggle-inline' : 'auth-theme-toggle-shell';

    assert.match(markup, new RegExp(`data-testid="${expectedTestId}"`), `${route} should render ${mode} toggle markup`);
    assert.match(markup, /data-testid="theme-toggle-button"/, `${route} should render the actual theme button`);
    assert.match(markup, /aria-label="Switch to light mode"/, `${route} should expose an accessible light-mode label in dark mode`);
  }
});

test('shared navbar shell toggle covers representative admin routes and capacity stays excluded', () => {
  const applications = renderToggleMarkupForRoute('/bananas/applications');
  const members = renderToggleMarkupForRoute('/bananas/members', 'light');

  assert.match(applications, /data-testid="auth-theme-toggle-shell"/);
  assert.match(applications, /data-testid="theme-toggle-button"/);
  assert.match(applications, /aria-label="Switch to light mode"/);
  assert.match(members, /data-testid="auth-theme-toggle-shell"/);
  assert.match(members, /aria-label="Switch to dark mode"/);
  assert.equal(renderToggleMarkupForRoute('/capacity'), '');
  assert.equal(renderToggleMarkupForRoute('/capacity/admin'), '');
});

test('representative inline admin/team routes render the shared visible toggle control in DOM markup', () => {
  const analytics = renderToggleMarkupForRoute('/bananas/analytics');
  const progress = renderToggleMarkupForRoute('/team/progress');

  assert.match(analytics, /data-testid="auth-theme-toggle-inline"/);
  assert.match(analytics, /data-testid="theme-toggle-button"/);
  assert.match(progress, /data-testid="auth-theme-toggle-inline"/);
  assert.match(progress, /data-testid="theme-toggle-button"/);
});

test('inline routes are explicitly wired to the shared authenticated toggle control', () => {
  const inlineFiles = [
    'app/bananas/analytics/AnalyticsClient.js',
    'app/bananas/financial-calendar/FinancialCalendarClient.js',
    'app/team/calendar/CalendarClient.js',
    'app/team/chat/TeamChatClient.js',
    'app/team/progress/ProgressClient.js',
  ];

  for (const relativePath of inlineFiles) {
    const content = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.match(content, /AuthenticatedThemeToggleControl/);
    assert.equal(content.includes('<ThemeToggle'), false, `${relativePath} should use the shared wrapper`);
  }

  const navbarContent = fs.readFileSync(
    path.join(REPO_ROOT, 'app/components/Navbar.js'),
    'utf8',
  );
  assert.match(navbarContent, /AuthenticatedNavbarThemeToggle/);
});

test('authenticated theme token swap changes page-surface variables between dark and light', () => {
  const dark = authThemeVars('dark');
  const light = authThemeVars('light');

  assert.notEqual(dark['--auth-root-bg'], light['--auth-root-bg']);
  assert.notEqual(dark['--auth-panel-bg'], light['--auth-panel-bg']);
  assert.notEqual(dark['--auth-card-bg'], light['--auth-card-bg']);
  assert.notEqual(dark['--auth-input-bg'], light['--auth-input-bg']);
  assert.notEqual(dark['--auth-text'], light['--auth-text']);
});

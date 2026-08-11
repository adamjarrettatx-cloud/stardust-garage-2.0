import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AuthenticatedThemeToggleControl from '../app/components/AuthenticatedThemeToggleControl.js';
import { authThemeVars, resolveAuthenticatedThemeScope } from '../lib/authenticated-theme.js';

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

function renderInlineToggle(theme = 'dark') {
  return renderToStaticMarkup(
    createElement(AuthenticatedThemeToggleControl, {
      theme,
      onToggle: () => {},
      mode: 'inline',
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
  ['/bananas/analytics', '/bananas/financials'],
  ['/bananas/financial-calendar', '/bananas/financials'],
]);
const domRoutes = authenticatedRoutes.filter((route) => !redirectRoutes.has(route)).sort();

test('authenticated route matrix covers every current DOM-serving admin/team route except capacity and redirects', () => {
  assert.ok(domRoutes.length > 0);
  for (const route of domRoutes) {
    assert.notEqual(resolveAuthenticatedThemeScope(route), null, `${route} should be authenticated themed`);
    assert.equal(route.startsWith('/capacity'), false, `${route} should not be a capacity route`);
  }
});

test('authenticated redirect aliases point only to already-themed routes with their own visible toggles', () => {
  for (const [route, target] of redirectRoutes) {
    const relativePath = `app${route}/page.js`.replace(/\[(.+?)\]/g, '[$1]');
    const content = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.match(content, new RegExp(`redirect\\('${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`));
    assert.notEqual(resolveAuthenticatedThemeScope(target), null);
  }
});

test('shared inline toggle renders visible button markup with the inline test id', () => {
  const darkMarkup = renderInlineToggle('dark');
  const lightMarkup = renderInlineToggle('light');

  assert.match(darkMarkup, /data-testid="auth-theme-toggle-inline"/);
  assert.match(darkMarkup, /data-testid="theme-toggle-button"/);
  assert.match(darkMarkup, /aria-label="Switch to light mode"/);
  assert.match(lightMarkup, /aria-label="Switch to dark mode"/);
});

test('capacity routes remain outside the authenticated theme shell', () => {
  assert.equal(resolveAuthenticatedThemeScope('/capacity'), null);
  assert.equal(resolveAuthenticatedThemeScope('/capacity/admin'), null);
  assert.equal(resolveAuthenticatedThemeScope('/capacity/front-door'), null);
  assert.equal(resolveAuthenticatedThemeScope('/capacity/exit-door'), null);
});

test('global navbar no longer renders an authenticated theme toggle', () => {
  const navbarContent = fs.readFileSync(path.join(REPO_ROOT, 'app/components/Navbar.js'), 'utf8');
  assert.doesNotMatch(navbarContent, /AuthenticatedNavbarThemeToggle/);
  assert.doesNotMatch(navbarContent, /theme-toggle/i);
});

test('shared inline page header owns the toggle contract for authenticated routes', () => {
  const headerContent = fs.readFileSync(path.join(REPO_ROOT, 'app/components/AuthenticatedPageHeader.js'), 'utf8');
  const toggleContent = fs.readFileSync(path.join(REPO_ROOT, 'app/components/AuthenticatedPageThemeToggle.js'), 'utf8');

  assert.match(headerContent, /data-testid="auth-page-header"/);
  assert.match(toggleContent, /mode="inline"/);
  assert.match(toggleContent, /AuthenticatedThemeToggleControl/);
});

test('authenticated route shell wraps themed routes in one shared content frame and leaves public routes unframed', () => {
  const shellContent = fs.readFileSync(path.join(REPO_ROOT, 'app/components/AuthenticatedRouteShell.js'), 'utf8');

  assert.match(shellContent, /data-testid="auth-theme-content-frame"/);
  assert.match(shellContent, /data-auth-theme-frame="true"/);
  assert.match(shellContent, /if \(!scope\)/);
});

test('representative authenticated routes render inline headers and avoid navbar-shell toggle markup', () => {
  const representativeFiles = [
    'app/bananas/page.js',
    'app/bananas/applications/page.js',
    'app/bananas/documents/page.js',
    'app/bananas/events/[id]/financials/page.js',
    'app/bananas/team/TeamManagementClient.js',
    'app/bananas/components/EventForm.js',
    'app/bananas/components/TtEventCreator.js',
  ];

  for (const relativePath of representativeFiles) {
    const content = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.match(content, /AuthenticatedPageHeader/);
    assert.doesNotMatch(content, /auth-theme-toggle-shell/);
  }
});

test('existing reference pages still render a single inline toggle in their page header', () => {
  const inlineReferenceFiles = [
    'app/bananas/analytics/AnalyticsClient.js',
    'app/bananas/financial-calendar/FinancialCalendarClient.js',
    'app/bananas/financials/FinancialsClient.js',
    'app/team/calendar/CalendarClient.js',
    'app/team/chat/TeamChatClient.js',
    'app/team/progress/ProgressClient.js',
  ];

  for (const relativePath of inlineReferenceFiles) {
    const content = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.match(content, /AuthenticatedThemeToggleControl/);
    assert.equal(content.includes('AuthenticatedPageHeader'), false, `${relativePath} should keep its existing inline header implementation`);
  }
});

test('existing reference pages rely on the shared frame instead of rendering their own outer cream panel', () => {
  const inlineReferenceFiles = [
    'app/bananas/analytics/AnalyticsClient.js',
    'app/bananas/financial-calendar/FinancialCalendarClient.js',
    'app/bananas/financials/FinancialsClient.js',
    'app/team/calendar/CalendarClient.js',
  ];

  for (const relativePath of inlineReferenceFiles) {
    const content = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.doesNotMatch(content, /rounded-\[28px\]/, `${relativePath} should not add a second outer panel radius`);
    assert.doesNotMatch(content, /background:\s*t\.panelBg/, `${relativePath} should not paint its own outer panel background`);
    assert.doesNotMatch(content, /boxShadow:\s*t\.panelShadow/, `${relativePath} should not paint its own outer panel shadow`);
  }
});

test('authenticated theme token swap keeps the outer shell transparent while changing the inner panel surface', () => {
  const dark = authThemeVars('dark');
  const light = authThemeVars('light');

  assert.equal(dark['--auth-root-bg'], 'transparent');
  assert.equal(light['--auth-root-bg'], 'transparent');
  assert.notEqual(dark['--auth-panel-bg'], light['--auth-panel-bg']);
  assert.notEqual(dark['--auth-panel-border'], light['--auth-panel-border']);
  assert.notEqual(dark['--auth-card-bg'], light['--auth-card-bg']);
  assert.notEqual(dark['--auth-input-bg'], light['--auth-input-bg']);
  assert.notEqual(dark['--auth-text'], light['--auth-text']);
});

test('light theme no longer adds a fixed full-page authenticated backdrop layer', () => {
  const globalsContent = fs.readFileSync(path.join(REPO_ROOT, 'app/globals.css'), 'utf8');

  assert.doesNotMatch(globalsContent, /\.auth-theme-root::before/);
  assert.match(globalsContent, /\.auth-theme-frame\s*\{/);
});

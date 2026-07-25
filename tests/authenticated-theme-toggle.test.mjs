import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AUTH_THEME_INLINE_TOGGLE_PATHS,
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

const adminRoutes = listPageRoutes(path.join(REPO_ROOT, 'app/bananas'), '/bananas').filter(
  (route) => route !== '/bananas/login',
);
const teamRoutes = listPageRoutes(path.join(REPO_ROOT, 'app/team'), '/team').filter(
  (route) => route !== '/team/login',
);
const redirectRoutes = new Map([
  ['/bananas/calendar', '/team/calendar'],
  ['/bananas/progress', '/team/progress'],
]);
const domRoutes = [...adminRoutes, ...teamRoutes]
  .filter((route) => !redirectRoutes.has(route))
  .sort();

const expectedInlineRoutes = [
  '/bananas',
  '/bananas/analytics',
  '/bananas/applications',
  '/bananas/applications/[id]',
  '/bananas/collaborations',
  '/bananas/collaborations/[id]',
  '/bananas/documents',
  '/bananas/documents/[id]',
  '/bananas/documents/templates',
  '/bananas/documents/templates/[id]',
  '/bananas/events/[id]',
  '/bananas/events/[id]/financials',
  '/bananas/events/new',
  '/bananas/financial-calendar',
  '/bananas/members',
  '/bananas/micro-parties',
  '/bananas/micro-parties/[id]',
  '/bananas/security',
  '/bananas/settings',
  '/bananas/signups',
  '/bananas/studio-bookings',
  '/bananas/studio-settings',
  '/bananas/team',
  '/bananas/venue-inquiries',
  '/bananas/venue-inquiries/[id]',
  '/team/calendar',
  '/team/chat',
  '/team/progress',
].sort();

const inlineHeaderFiles = [
  'app/bananas/page.js',
  'app/bananas/applications/page.js',
  'app/bananas/applications/[id]/page.js',
  'app/bananas/collaborations/page.js',
  'app/bananas/collaborations/[id]/page.js',
  'app/bananas/documents/page.js',
  'app/bananas/documents/[id]/DocumentDetailClient.js',
  'app/bananas/documents/templates/page.js',
  'app/bananas/documents/templates/[id]/TemplateEditorClient.js',
  'app/bananas/events/new/NewEventChooser.js',
  'app/bananas/components/EventForm.js',
  'app/bananas/components/TtEventCreator.js',
  'app/bananas/events/[id]/financials/page.js',
  'app/bananas/members/page.js',
  'app/bananas/micro-parties/page.js',
  'app/bananas/micro-parties/[id]/page.js',
  'app/bananas/security/page.js',
  'app/bananas/settings/page.js',
  'app/bananas/signups/page.js',
  'app/bananas/studio-bookings/page.js',
  'app/bananas/studio-settings/page.js',
  'app/bananas/team/TeamManagementClient.js',
  'app/bananas/venue-inquiries/page.js',
  'app/bananas/venue-inquiries/[id]/page.js',
  'app/team/calendar/CalendarClient.js',
  'app/team/chat/TeamChatClient.js',
  'app/team/progress/ProgressClient.js',
  'app/bananas/analytics/AnalyticsClient.js',
  'app/bananas/financial-calendar/FinancialCalendarClient.js',
];

const lightSurfaceFiles = [
  'app/globals.css',
  'app/components/AuthenticatedThemeProvider.js',
  'app/components/NavLinks.js',
  'app/bananas/page.js',
  'app/bananas/AdminDashboardClient.js',
  'app/bananas/components/EventsSection.js',
  'app/bananas/components/EventForm.js',
  'app/bananas/components/TtEventCreator.js',
  'app/bananas/documents/[id]/DocumentDetailClient.js',
  'app/bananas/documents/templates/[id]/TemplateEditorClient.js',
  'app/bananas/settings/SettingsForm.js',
  'app/bananas/studio-settings/StudioSettingsForm.js',
  'app/bananas/team/TeamManagementClient.js',
  'app/bananas/events/[id]/financials/EventFinancialsClient.js',
];

test('authenticated inline toggle route matrix matches every DOM-serving authenticated page', () => {
  const actualInline = domRoutes
    .filter((route) => resolveAuthenticatedThemeToggleMode(route) === 'inline')
    .sort();
  const actualNone = domRoutes
    .filter((route) => resolveAuthenticatedThemeToggleMode(route) === 'none')
    .sort();

  assert.deepEqual([...AUTH_THEME_INLINE_TOGGLE_PATHS].sort(), expectedInlineRoutes);
  assert.deepEqual(actualInline, expectedInlineRoutes);
  assert.deepEqual(actualNone, []);
});

test('redirect aliases only point to already-covered themed routes', () => {
  for (const [route, target] of redirectRoutes) {
    const relativePath = `app${route}/page.js`.replace(/\[(.+?)\]/g, '[$1]');
    const content = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.match(content, new RegExp(`redirect\\('${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\)`));
    assert.equal(resolveAuthenticatedThemeToggleMode(target), 'inline');
  }
});

test('no global, navbar, shell, floating, or overlay-owned authenticated toggle remains', () => {
  const navbar = fs.readFileSync(path.join(REPO_ROOT, 'app/components/Navbar.js'), 'utf8');
  const themeProvider = fs.readFileSync(path.join(REPO_ROOT, 'app/components/AuthenticatedThemeProvider.js'), 'utf8');
  const routeShell = fs.readFileSync(path.join(REPO_ROOT, 'app/components/AuthenticatedRouteShell.js'), 'utf8');

  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'app/components/AuthenticatedNavbarThemeToggle.js')), false);
  assert.equal(navbar.includes('AuthenticatedNavbarThemeToggle'), false);
  assert.equal(navbar.includes('auth-theme-toggle-shell'), false);
  assert.equal(themeProvider.includes('auth-theme-toggle-shell'), false);
  assert.equal(themeProvider.includes('AuthenticatedThemeToggleControl'), false);
  assert.equal(routeShell.includes('AuthenticatedThemeToggleControl'), false);
});

test('covered routes use inline page-owned header toggle implementations', () => {
  for (const relativePath of inlineHeaderFiles) {
    const content = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    const hasInlineHeader =
      content.includes('AuthenticatedPageHeader') ||
      content.includes('AuthenticatedInlineThemeToggle') ||
      content.includes('AuthenticatedThemeToggleControl');

    assert.equal(hasInlineHeader, true, `${relativePath} should render an inline page toggle`);
  }
});

test('capacity routes stay excluded from authenticated theme toggles', () => {
  assert.equal(resolveAuthenticatedThemeToggleMode('/capacity'), 'none');
  assert.equal(resolveAuthenticatedThemeToggleMode('/capacity/front-door'), 'none');
  assert.equal(resolveAuthenticatedThemeToggleMode('/capacity/admin'), 'none');
});

test('light-mode route surfaces use authenticated palette tokens and hide auth starfield', () => {
  const globals = fs.readFileSync(path.join(REPO_ROOT, 'app/globals.css'), 'utf8');
  assert.match(globals, /html\[data-auth-scope]\[data-auth-theme='light'] \.auth-cosmos-background/);
  assert.match(globals, /body\[data-auth-scope]\[data-auth-theme='light']/);
  assert.match(globals, /--auth-root-bg/);

  for (const relativePath of lightSurfaceFiles) {
    const content = fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
    assert.match(
      content,
      /var\(--auth-|auth-theme-|data-auth-theme|data-auth-scope/,
      `${relativePath} should use authenticated theme tokens or selectors`,
    );
  }
});

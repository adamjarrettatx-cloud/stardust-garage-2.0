import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FINANCIAL_THEMES,
  ANALYTICS_THEMES,
  STATE_TONE,
  stateColor,
} from '../lib/admin-theme.js';
import {
  AUTH_THEME_STORAGE_KEYS,
  AUTH_THEMES,
  resolveAuthenticatedThemeScope,
  resolveAuthTheme,
} from '../lib/authenticated-theme.js';
import { ENTRY_STATE } from '../lib/financial-calendar.js';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// --- Palette parity ---------------------------------------------------------
// The light theme is applied by swapping token values, never by adding/removing
// tokens. If dark and light drift out of key-parity, some element silently keeps
// its opposite-theme color (a dark-on-dark / light-on-light readability bug), so
// we lock the two halves to the exact same key set.

function assertSameKeys(a, b, label) {
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${label}: dark/light token keys must match`);
}

test('Financial Calendar palette: dark and light expose identical tokens', () => {
  assertSameKeys(FINANCIAL_THEMES.dark, FINANCIAL_THEMES.light, 'financial');
});

test('Event Analytics palette: dark and light expose identical tokens', () => {
  assertSameKeys(ANALYTICS_THEMES.dark, ANALYTICS_THEMES.light, 'analytics');
});

test('authenticated theme storage keys are shared by scope', () => {
  assert.deepEqual(AUTH_THEME_STORAGE_KEYS, {
    admin: 'sdg-auth-admin-theme',
    team: 'sdg-auth-team-theme',
  });
});

test('authenticated themes expose identical dark/light token keys and safe fallback', () => {
  assertSameKeys(AUTH_THEMES.dark, AUTH_THEMES.light, 'authenticated');
  assert.equal(resolveAuthTheme('light'), 'light');
  assert.equal(resolveAuthTheme('dark'), 'dark');
  assert.equal(resolveAuthTheme('bogus'), 'dark');
});

// --- Light-mode readability ------------------------------------------------
// The whole point of the light theme is legibility on a pale panel: the green
// revenue accent must NOT stay the bright dark-mode green (#4ade80), which is
// low-contrast on white. It should deepen to an emerald. Likewise the light
// panel is a solid cream card while dark sits directly on the cosmic backdrop.

test('light revenue accent deepens for contrast on the pale panel', () => {
  for (const themes of [FINANCIAL_THEMES, ANALYTICS_THEMES]) {
    assert.equal(themes.dark.rev, '#4ade80');
    assert.notEqual(themes.light.rev, themes.dark.rev);
    assert.equal(themes.light.rev, '#047857');
  }
});

test('light mode uses a solid cream panel; dark mode is transparent', () => {
  for (const themes of [FINANCIAL_THEMES, ANALYTICS_THEMES]) {
    assert.equal(themes.dark.panelBg, null);
    assert.equal(themes.light.panelBg, '#faf9f6');
  }
});

test('primary text and today marker invert between themes (no dark-on-dark)', () => {
  const d = FINANCIAL_THEMES.dark;
  const l = FINANCIAL_THEMES.light;
  assert.notEqual(d.text, l.text);
  assert.notEqual(d.todayBg, l.todayBg);
  assert.notEqual(d.todayText, l.todayText);
  // The today pill flips: dark shows a white pill w/ dark text, light the reverse.
  assert.equal(l.todayBg, '#1a1a1d');
  assert.equal(l.todayText, '#ffffff');
});

test('authenticated route scope covers every team/admin page except logins and capacity', () => {
  const bananasPages = fs
    .readdirSync(path.join(REPO_ROOT, 'app/bananas'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === 'page.js')
    .map((entry) => `/bananas/${path.dirname(entry.parentPath.replace(`${path.join(REPO_ROOT, 'app/bananas')}${path.sep}`, '')).replace(/\\/g, '/')}`)
    .map((route) => route === '/bananas/.' ? '/bananas' : route.replace(/\/\.$/, ''));

  const teamPages = fs
    .readdirSync(path.join(REPO_ROOT, 'app/team'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name === 'page.js')
    .map((entry) => `/team/${path.dirname(entry.parentPath.replace(`${path.join(REPO_ROOT, 'app/team')}${path.sep}`, '')).replace(/\\/g, '/')}`)
    .map((route) => route === '/team/.' ? '/team' : route.replace(/\/\.$/, ''));

  const expectedAdminRoutes = bananasPages.filter((route) => route !== '/bananas/login');
  const expectedTeamRoutes = teamPages.filter((route) => route !== '/team/login');

  for (const route of expectedAdminRoutes) {
    assert.equal(resolveAuthenticatedThemeScope(route), 'admin', `${route} should use admin authenticated theming`);
  }
  for (const route of expectedTeamRoutes) {
    assert.equal(resolveAuthenticatedThemeScope(route), 'team', `${route} should use team authenticated theming`);
  }

  assert.equal(resolveAuthenticatedThemeScope('/bananas/login'), null);
  assert.equal(resolveAuthenticatedThemeScope('/team/login'), null);
  assert.equal(resolveAuthenticatedThemeScope('/capacity'), null);
  assert.equal(resolveAuthenticatedThemeScope('/capacity/front-door'), null);
  assert.equal(resolveAuthenticatedThemeScope('/capacity/admin'), null);
});

// --- State tone resolution --------------------------------------------------

test('stateColor maps each entry state to a theme-aware tone', () => {
  const l = FINANCIAL_THEMES.light;
  assert.equal(stateColor(ENTRY_STATE.UNLINKED, l), l.warn);
  assert.equal(stateColor(ENTRY_STATE.NOT_CONFIGURED, l), l.warn);
  assert.equal(stateColor(ENTRY_STATE.ERROR, l), l.err);
  assert.equal(stateColor(ENTRY_STATE.PENDING, l), l.muted);
  assert.equal(stateColor(ENTRY_STATE.ZERO, l), l.muted);
  // Unknown / OK states fall back to muted rather than throwing.
  assert.equal(stateColor(ENTRY_STATE.OK, l), l.muted);
  assert.equal(stateColor('bogus', l), l.muted);
});

test('STATE_TONE only references known tones', () => {
  const allowed = new Set(['muted', 'warn', 'err']);
  for (const tone of Object.values(STATE_TONE)) {
    assert.ok(allowed.has(tone), `unexpected tone: ${tone}`);
  }
});

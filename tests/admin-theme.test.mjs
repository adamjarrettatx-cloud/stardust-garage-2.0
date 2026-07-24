import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FINANCIAL_THEMES,
  ANALYTICS_THEMES,
  FINANCIAL_THEME_KEY,
  ANALYTICS_THEME_KEY,
  STATE_TONE,
  stateColor,
} from '../lib/admin-theme.js';
import { ENTRY_STATE } from '../lib/financial-calendar.js';

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

test('theme storage keys are distinct and page-scoped', () => {
  assert.equal(FINANCIAL_THEME_KEY, 'sdg-admin-financial-theme');
  assert.equal(ANALYTICS_THEME_KEY, 'sdg-admin-analytics-theme');
  assert.notEqual(FINANCIAL_THEME_KEY, ANALYTICS_THEME_KEY);
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

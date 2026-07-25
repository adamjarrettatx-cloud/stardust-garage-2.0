import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROGRESS_DRAWER_THEMES,
  getProgressDrawerTheme,
} from '../lib/progress-drawer-theme.js';

function assertSameKeys(a, b, label) {
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${label}: dark/light token keys must match`);
}

test('Progress drawer palettes expose identical dark/light token keys', () => {
  assertSameKeys(PROGRESS_DRAWER_THEMES.dark, PROGRESS_DRAWER_THEMES.light, 'progress-drawer');
});

test('light drawer theme matches the cream progress page palette', () => {
  const dark = PROGRESS_DRAWER_THEMES.dark;
  const light = PROGRESS_DRAWER_THEMES.light;

  assert.equal(dark.panelBg, '#0f0f0f');
  assert.equal(light.panelBg, '#f2efe8');
  assert.equal(light.cardBg, '#ffffff');
  assert.equal(light.headerBg, light.panelBg);
  assert.equal(light.inputBg, '#ffffff');
  assert.equal(light.controlBg, 'rgba(0,0,0,0.04)');
  assert.equal(light.accent, '#ffb84d');
  assert.equal(light.accentLabel, '#7c3d0a');
});

test('light drawer theme deepens text, borders, and error colors for contrast', () => {
  const dark = PROGRESS_DRAWER_THEMES.dark;
  const light = PROGRESS_DRAWER_THEMES.light;

  assert.notEqual(light.text, dark.text);
  assert.notEqual(light.inputBorder, dark.inputBorder);
  assert.notEqual(light.errorText, dark.errorText);
  assert.equal(light.text, '#1a1a1d');
  assert.equal(light.inputBorder, 'rgba(0,0,0,0.15)');
  assert.equal(light.errorText, '#b91c1c');
  assert.equal(light.focusBorder, '#7c3d0a');
});

test('getProgressDrawerTheme falls back to dark for unknown themes', () => {
  assert.equal(getProgressDrawerTheme('light'), PROGRESS_DRAWER_THEMES.light);
  assert.equal(getProgressDrawerTheme('bogus'), PROGRESS_DRAWER_THEMES.dark);
  assert.equal(getProgressDrawerTheme(), PROGRESS_DRAWER_THEMES.dark);
});

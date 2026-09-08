import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Contract tests for lib/tickets/trial-pass-preview.js. Node cannot resolve
// the "@/lib/profile-photo" alias without the Next bundler, so we assert on
// the source directly \u2014 same pattern as buyer-preview.test.mjs.

const src = readFileSync(new URL('../lib/tickets/trial-pass-preview.js', import.meta.url), 'utf8');

test('imports the shared signed-URL helper', () => {
  assert.match(src, /from\s+'@\/lib\/profile-photo'/);
  assert.match(src, /createProfilePhotoSignedUrl/);
});

test('reads profile_photo_path from the trial_passes row it was passed', () => {
  assert.match(src, /pass\?\.profile_photo_path/);
  assert.equal(/from\('trial_passes'\)/.test(src), false, 'helper must NOT re-query trial_passes \u2014 the caller already selected it');
});

test('never returns the raw storage path in the preview object', () => {
  const returnBlocks = src.match(/return \{[^}]+\};/g) || [];
  for (const block of returnBlocks) {
    assert.equal(/profile_photo_path/.test(block), false, `path leaked in: ${block}`);
  }
});

test('extracts firstName from full_name safely (handles missing)', () => {
  assert.match(src, /String\(pass\?\.full_name\s*\|\|\s*''\)/);
  assert.match(src, /\.split\(' '\)/);
});

test('falls back to hasPhoto=false when no path is on file', () => {
  assert.match(src, /if\s*\(!admin\s*\|\|\s*!pass\?\.profile_photo_path\)\s*return fallback/);
});

test('swallows signed-URL errors and returns the safe fallback', () => {
  assert.match(src, /catch \(err\)/);
  assert.match(src, /return fallback/);
});

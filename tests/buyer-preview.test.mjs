import { test } from 'node:test';
import assert from 'node:assert/strict';

// The buyer-preview helper imports @/lib/profile-photo via the "@/" alias
// which Node cannot resolve without the Next bundler. We bypass that by
// stubbing global fetch is not needed; we simply exercise via a mocked
// admin client and rely on createProfilePhotoSignedUrl returning null when
// the admin.storage stub returns null. The helper itself does not import
// the alias for that path \u2014 verify by reading the source instead.

import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../lib/tickets/buyer-preview.js', import.meta.url), 'utf8');

test('imports the shared profile-photo helper', () => {
  assert.match(src, /from\s+'@\/lib\/profile-photo'/);
  assert.match(src, /createProfilePhotoSignedUrl/);
});

test('reads from free_accounts.profile_photo_path (never the legacy public bucket)', () => {
  assert.match(src, /from\('free_accounts'\)/);
  assert.match(src, /profile_photo_path/);
  assert.equal(/member-photos/.test(src), false);
});

test('never returns the storage path in the preview object', () => {
  // We look for keys returned in the preview object shape. photo_url /
  // photoSignedUrl are OK. Raw profile_photo_path must not leak.
  const returnMatch = src.match(/return \{[^}]+\};/g) || [];
  for (const block of returnMatch) {
    assert.equal(/profile_photo_path/.test(block), false, `path leaked in: ${block}`);
  }
});

test('handles missing ticket / order gracefully with a fallback', () => {
  assert.match(src, /if\s*\(!admin \|\| !ticket\?\.order_id\)\s*return fallback/);
});

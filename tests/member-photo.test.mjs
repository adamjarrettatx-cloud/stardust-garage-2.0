import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Contract tests for lib/member-photo.js. Node cannot resolve the
// "@/lib/profile-photo" alias without the Next bundler, so we assert on the
// source directly \u2014 same pattern as buyer-preview and trial-pass-preview.

const src = readFileSync(new URL('../lib/member-photo.js', import.meta.url), 'utf8');

test('imports the shared signed-URL helper from profile-photo', () => {
  assert.match(src, /from\s+'@\/lib\/profile-photo'/);
  assert.match(src, /createProfilePhotoSignedUrl/);
});

test('prefers profile_photo_path over photo_url', () => {
  const orderMatch = src.match(/if\s*\(row\.profile_photo_path\)[\s\S]*?return\s+row\.photo_url\s*\|\|\s*null/);
  assert.ok(orderMatch, 'expected profile_photo_path path checked before returning photo_url');
});

test('never leaks the raw storage path in a return value', () => {
  // The function returns either the signed URL, the legacy photo_url, or null.
  // A bare `return row.profile_photo_path` would leak the private bucket key,
  // which is not a URL and would fail to render.
  assert.equal(/return row\.profile_photo_path/.test(src), false);
});

test('falls back to photo_url when signing throws', () => {
  const singleFn = sliceBetween(src, 'export async function resolveMemberPhotoUrl', 'export async function resolveMemberPhotoUrls');
  assert.match(singleFn, /catch \(err\)/);
  assert.match(singleFn, /return row\.photo_url\s*\|\|\s*null/);
});

test('bulk helper runs in parallel via Promise.all', () => {
  const bulk = sliceBetween(src, 'export async function resolveMemberPhotoUrls', '$$END$$');
  assert.match(bulk, /Promise\.all/);
  assert.match(bulk, /rows\.map/);
});

test('bulk helper returns a Map keyed by row.id', () => {
  const bulk = sliceBetween(src, 'export async function resolveMemberPhotoUrls', '$$END$$');
  assert.match(bulk, /new Map/);
  assert.match(bulk, /map\.set\(row\.id/);
});

test('bulk helper handles empty/non-array input safely', () => {
  const bulk = sliceBetween(src, 'export async function resolveMemberPhotoUrls', '$$END$$');
  assert.match(bulk, /!Array\.isArray\(rows\)/);
});

function sliceBetween(source, startMarker, endMarker) {
  const startIdx = source.indexOf(startMarker);
  if (startIdx < 0) return null;
  const rest = source.slice(startIdx);
  if (endMarker === '$$END$$') return rest;
  const endIdx = rest.indexOf(endMarker);
  return endIdx < 0 ? rest : rest.slice(0, endIdx);
}

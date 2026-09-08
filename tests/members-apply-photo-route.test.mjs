import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// /api/members/apply/photo accepts a public unauthenticated upload from
// the paid-membership application form. It must:
//   - Rate-limit by IP (this is the only guard)
//   - Write to the PRIVATE profile-photos bucket, NOT the legacy public
//     member-photos bucket
//   - Return a server-generated UUID path (never trust a client-supplied id)
//   - Return a short-lived signed URL for immediate preview

const src = readFileSync(
  new URL('../app/api/members/apply/photo/route.js', import.meta.url),
  'utf8',
);

test('is public (no bearer, no session gate)', () => {
  assert.equal(/Authorization/.test(src), false);
  assert.equal(/getUser\(\)/.test(src), false);
});

test('applies IP-based rate limiting', () => {
  assert.match(src, /rateLimit\(\{/);
  assert.match(src, /keyFromRequest\(request/);
  assert.match(src, /status:\s*429/);
});

test('writes to the private profile-photos bucket', () => {
  assert.match(src, /PROFILE_PHOTO_BUCKET/);
  assert.equal(/'member-photos'/.test(src), false);
});

test('storage layout is member-app/<uuid>/photo.<ext>', () => {
  assert.match(src, /member-app\/\$\{[^}]+\}\/photo\.\$\{[^}]+\}/);
});

test('uuid is server-generated, not accepted from the client', () => {
  assert.match(src, /randomUUID\(\)/);
  // Must not read an id from the incoming form
  assert.equal(/form\.get\('applicationId'\)/.test(src), false);
  assert.equal(/form\.get\('id'\)/.test(src), false);
});

test('validates mime + size using shared constants', () => {
  assert.match(src, /ALLOWED_PROFILE_PHOTO_MIME\.includes\(file\.type\)/);
  assert.match(src, /MAX_PROFILE_PHOTO_BYTES/);
  assert.match(src, /file\.size\s*<\s*1024/);
});

test('response returns the server-generated storage path plus a signed URL', () => {
  const successMatch = src.match(/return NextResponse\.json\(\{[^}]*ok:\s*true[^}]*\}[^)]*\)/s);
  assert.ok(successMatch, 'expected an ok:true response');
  const body = successMatch[0];
  assert.match(body, /photoPath/);
  assert.match(body, /signedUrl/);
});

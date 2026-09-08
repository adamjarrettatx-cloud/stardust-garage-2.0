import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The /api/trial-pass/photo route uploads a face photo for a trial pass,
// keyed by the same token that authenticates the /pass/[token] page. We
// pin its contract by reading the source: the Twilio verify path must
// stay untouched, the private profile-photos bucket must be used, and
// the response must never leak the token or storage path.

const src = readFileSync(
  new URL('../app/api/trial-pass/photo/route.js', import.meta.url),
  'utf8',
);

test('does not import or invoke Twilio helpers', () => {
  assert.equal(/from\s+'@\/lib\/twilio-verify'/.test(src), false);
  assert.equal(/startVerification\(/.test(src), false);
  assert.equal(/checkVerification\(/.test(src), false);
});

test('uses the private profile-photos bucket via the shared helper', () => {
  assert.match(src, /from\s+'@\/lib\/profile-photo'/);
  assert.match(src, /PROFILE_PHOTO_BUCKET/);
  // Must NOT hard-code the legacy public member-photos bucket
  assert.equal(/'member-photos'/.test(src), false);
});

test('authenticates by trial-pass token, not Supabase bearer', () => {
  assert.match(src, /isWellFormedPassToken/);
  assert.match(src, /hashPassToken/);
  // No Authorization header parsing here
  assert.equal(/Authorization/.test(src), false);
});

test('storage layout is trial-pass/<id>/photo.<ext>', () => {
  assert.match(src, /trial-pass\/\$\{[^}]+\}\/photo\.\$\{[^}]+\}/);
});

test('updates trial_passes with profile_photo_path and timestamp', () => {
  assert.match(src, /from\('trial_passes'\)/);
  assert.match(src, /profile_photo_path:/);
  assert.match(src, /profile_photo_uploaded_at:/);
});

test('response body does not include the token or the raw storage path', () => {
  // Grab the NextResponse.json(...) success payload region
  const successMatch = src.match(/return NextResponse\.json\(\{[^}]*ok:\s*true[^}]*\}[^)]*\)/s);
  assert.ok(successMatch, 'expected an ok:true response');
  const body = successMatch[0];
  assert.equal(/token/.test(body), false, 'response must not include the token');
  assert.equal(/\bpath\b/.test(body), false, 'response must not include the raw storage path');
  assert.match(body, /signedUrl/);
});

test('rejects oversized and empty uploads', () => {
  assert.match(src, /MAX_PROFILE_PHOTO_BYTES/);
  assert.match(src, /file\.size\s*<\s*1024/);
});

test('rejects unsupported mime types with 415', () => {
  assert.match(src, /ALLOWED_PROFILE_PHOTO_MIME\.includes\(file\.type\)/);
  assert.match(src, /status:\s*415/);
});

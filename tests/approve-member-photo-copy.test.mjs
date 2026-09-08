import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Pin the contract that approving a member copies BOTH photo columns from the
// application row onto the new member_profiles row. This is what lets the
// members admin UI mint signed URLs for post-PR-B.3 approvals while old
// legacy photo_url rows keep rendering.

const src = readFileSync(
  new URL('../app/api/admin/approve-member/route.js', import.meta.url),
  'utf8',
);

test('upsert into member_profiles includes profile_photo_path from the application', () => {
  const upsertBlock = sliceBetween(src, "from('member_profiles')", "if (profileError)");
  assert.ok(upsertBlock, 'expected the profile upsert block');
  assert.match(upsertBlock, /profile_photo_path:\s*application\.profile_photo_path\s*\|\|\s*null/);
});

test('upsert still copies legacy photo_url for backward compat', () => {
  const upsertBlock = sliceBetween(src, "from('member_profiles')", "if (profileError)");
  assert.match(upsertBlock, /photo_url:\s*application\.photo_url/);
});

test('approval still requires SOME photo (either column) as a gate', () => {
  assert.match(
    src,
    /Boolean\(application\.photo_url\)\s*\|\|\s*Boolean\(application\.profile_photo_path\)/,
  );
  assert.match(src, /A profile photo is required before approving/);
});

test('approval still requires admin MFA', () => {
  assert.match(src, /requireAdminMfa\(\)/);
});

function sliceBetween(source, startMarker, endMarker) {
  const startIdx = source.indexOf(startMarker);
  if (startIdx < 0) return null;
  const rest = source.slice(startIdx);
  const endIdx = rest.indexOf(endMarker);
  return endIdx < 0 ? rest : rest.slice(0, endIdx);
}

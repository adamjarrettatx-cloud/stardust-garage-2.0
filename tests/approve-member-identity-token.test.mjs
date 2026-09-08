import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Contract: approving a member auto-issues a member_identity_tokens row.
// This is the seed for PR F's Member ID badge \u2014 every approved member is
// expected to have exactly one live token, so any regression here breaks
// the door scanner's Member ID mode for that member.

const src = readFileSync(
  new URL('../app/api/admin/approve-member/route.js', import.meta.url),
  'utf8',
);

test('approval imports the member-identity helpers', () => {
  assert.match(src, /from\s+'@\/lib\/member-identity'/);
  assert.match(src, /generateMemberIdentityToken/);
  assert.match(src, /hashMemberIdentityToken/);
});

test('member_profiles upsert now returns the row id (needed for token insert)', () => {
  const block = sliceBetween(src, "from('member_profiles')", "if (profileError");
  assert.match(block, /\.select\('id'\)/);
  assert.match(block, /\.single\(\)/);
});

test('inserts a token row with member_profile_id + hash + raw', () => {
  const block = sliceBetween(src, "from('member_identity_tokens')", 'if (tokenError');
  assert.ok(block, 'expected the identity-token insert block');
  assert.match(block, /member_profile_id:\s*profileRow\.id/);
  assert.match(block, /token_hash:\s*tokenHash/);
  assert.match(block, /token_raw:\s*rawToken/);
});

test('token issuance failure does NOT fail the approval (logged only)', () => {
  // The insert lives inside a try/catch that only console.errors, and the
  // duplicate/unique errors are swallowed silently. If someone regresses this
  // to `throw` or `return NextResponse.json({error})`, the whole approval
  // starts failing for members whose token row already exists.
  const block = sliceBetween(src, 'Issue an identity token', 'Mark application approved');
  assert.match(block, /try \{/);
  assert.match(block, /catch \(err\)/);
  assert.doesNotMatch(block, /return NextResponse\.json/);
  assert.doesNotMatch(block, /throw /);
});

function sliceBetween(source, startMarker, endMarker) {
  const startIdx = source.indexOf(startMarker);
  if (startIdx < 0) return null;
  const rest = source.slice(startIdx);
  const endIdx = rest.indexOf(endMarker);
  return endIdx < 0 ? rest : rest.slice(0, endIdx);
}

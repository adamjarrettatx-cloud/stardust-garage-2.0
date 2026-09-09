import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const approval = readFileSync(new URL('../app/api/admin/approve-member/route.js', import.meta.url), 'utf8');
const memberId = readFileSync(new URL('../app/member/id/page.js', import.meta.url), 'utf8');

test('member approval does not persist a raw badge credential', () => {
  assert.doesNotMatch(approval, /member_identity_tokens/);
  assert.doesNotMatch(approval, /token_raw/);
  assert.doesNotMatch(approval, /generateMemberIdentityToken/);
});

test('the signed-in member ID entry point is the only issuance path and uses the hash-only service', () => {
  assert.match(memberId, /getOrIssueMemberIdentityToken/);
  assert.match(memberId, /generateMemberIdentityToken/);
  assert.match(memberId, /hashMemberIdentityToken/);
  assert.doesNotMatch(memberId, /token_raw/);
});

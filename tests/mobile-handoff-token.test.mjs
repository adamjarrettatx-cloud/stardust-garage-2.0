import test from 'node:test';
import assert from 'node:assert/strict';
import { sealHandoff, openHandoff } from '../lib/mobile-handoff-token.mjs';
const secret='isolated-test-only-not-a-real-key-1234567890';
const payload={tokenHash:'private-one-time-auth-hash',userId:'own-user',returnTo:'/members?mobile=1'};
test('handoff is encrypted, identity-bound and expires exactly after 60 seconds',()=>{
  const token=sealHandoff(payload,secret,100000);
  assert.ok(!Buffer.from(token.slice(3),'base64url').toString().includes(payload.tokenHash));
  assert.equal(openHandoff(token,secret,159999).userId,'own-user');
  assert.equal(openHandoff(token,secret,160000),null);
  assert.equal(openHandoff(token,secret,99999),null);
});
test('handoff rejects modification, key mismatch, oversized input and legacy raw auth hashes',()=>{
  const token=sealHandoff(payload,secret,100000);
  assert.equal(openHandoff(`v1.A${token.slice(4)}`,secret,100001),null);
  assert.equal(openHandoff(token,secret+'other',100001),null);
  assert.equal(openHandoff(payload.tokenHash,secret,100001),null);
  assert.equal(openHandoff('v1.'+'a'.repeat(5000),secret,100001),null);
  assert.throws(()=>sealHandoff(payload,'short',100000));
});

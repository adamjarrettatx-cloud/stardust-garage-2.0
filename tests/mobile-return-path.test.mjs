import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeMobileReturnPath } from '../lib/mobile-return-path.js';
test('handoff allows internal destinations and rejects browser-normalized offsite paths', () => {
  const origin = 'https://www.sdgatx.com';
  assert.equal(safeMobileReturnPath('/account/profile#w9', origin), '/account/profile#w9');
  for (const path of ['//evil.test', '/\\evil.test', '/\nevil.test', 'https://evil.test', '/handoff?token=x', '/auth/callback']) {
    assert.equal(safeMobileReturnPath(path, origin), '/');
  }
});

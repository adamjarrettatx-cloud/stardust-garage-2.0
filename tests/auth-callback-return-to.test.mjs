import test from 'node:test';
import assert from 'node:assert/strict';

import { isAllowedReturnTo } from '../lib/auth-callback-return-to.js';

test('allows the production mobile scheme', () => {
  assert.equal(isAllowedReturnTo('sdgatx://auth/callback'), true);
  assert.equal(isAllowedReturnTo('sdgatx://auth/callback?buy=1'), true);
});

test('allows Expo Go / EAS dev-client schemes', () => {
  assert.equal(isAllowedReturnTo('exp://192.168.1.10:19000/--/auth'), true);
  assert.equal(isAllowedReturnTo('exp+sdg-mobile://expo-development-client'), true);
});

test('rejects Expo Go / EAS dev-client schemes in production', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(isAllowedReturnTo('exp://attacker.example/--/auth'), false);
    assert.equal(isAllowedReturnTo('exp+sdg-mobile://expo-development-client'), false);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
});

test('BLOCKS arbitrary https origins (the C-01 exploit)', () => {
  assert.equal(isAllowedReturnTo('https://evil.example.com/collect'), false);
  assert.equal(isAllowedReturnTo('https://sdgatx.com/'), false); // even our own origin
  assert.equal(isAllowedReturnTo('http://attacker.local'), false);
});

test('BLOCKS pseudo-scheme XSS vectors', () => {
  assert.equal(isAllowedReturnTo('javascript:alert(1)'), false);
  assert.equal(isAllowedReturnTo('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isAllowedReturnTo('file:///etc/passwd'), false);
  assert.equal(isAllowedReturnTo('vbscript:msgbox("x")'), false);
});

test('BLOCKS scheme-close-to-real look-alikes', () => {
  assert.equal(isAllowedReturnTo('sdgatx.evil://x'), false);
  assert.equal(isAllowedReturnTo('sdgatxx://x'), false);
  assert.equal(isAllowedReturnTo('xsdgatx://x'), false);
  assert.equal(isAllowedReturnTo('exp-evil://x'), false);
});

test('handles percent-encoded input (Supabase forwards it URL-encoded)', () => {
  assert.equal(isAllowedReturnTo(encodeURIComponent('sdgatx://auth/callback')), true);
  assert.equal(isAllowedReturnTo(encodeURIComponent('https://evil.example')), false);
});

test('rejects empty, null, non-strings, malformed URLs', () => {
  assert.equal(isAllowedReturnTo(''), false);
  assert.equal(isAllowedReturnTo(null), false);
  assert.equal(isAllowedReturnTo(undefined), false);
  assert.equal(isAllowedReturnTo(42), false);
  assert.equal(isAllowedReturnTo({}), false);
  assert.equal(isAllowedReturnTo('not a url'), false);
  assert.equal(isAllowedReturnTo('://missing-scheme'), false);
  assert.equal(isAllowedReturnTo('%ZZ'), false); // bad percent-encoding
});

test('rejects protocol-relative and path-only strings', () => {
  assert.equal(isAllowedReturnTo('//evil.example/'), false);
  assert.equal(isAllowedReturnTo('/dashboard'), false);
  assert.equal(isAllowedReturnTo('#fragment'), false);
});

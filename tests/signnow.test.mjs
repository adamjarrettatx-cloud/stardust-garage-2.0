import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSignNowConfigured,
  SignNowNotConfiguredError,
  sendForSignature,
  verifyWebhook,
} from '../lib/signnow.js';

test('isSignNowConfigured reflects SIGNNOW_API_KEY presence', () => {
  const prev = process.env.SIGNNOW_API_KEY;
  delete process.env.SIGNNOW_API_KEY;
  assert.equal(isSignNowConfigured(), false);
  process.env.SIGNNOW_API_KEY = 'test-key';
  assert.equal(isSignNowConfigured(), true);
  if (prev === undefined) delete process.env.SIGNNOW_API_KEY;
  else process.env.SIGNNOW_API_KEY = prev;
});

test('sendForSignature throws SignNowNotConfiguredError when unconfigured', async () => {
  const prev = process.env.SIGNNOW_API_KEY;
  delete process.env.SIGNNOW_API_KEY;
  await assert.rejects(() => sendForSignature(), SignNowNotConfiguredError);
  if (prev !== undefined) process.env.SIGNNOW_API_KEY = prev;
});

test('verifyWebhook rejects until implemented', () => {
  assert.equal(verifyWebhook('body', 'sig'), false);
});

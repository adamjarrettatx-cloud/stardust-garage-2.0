import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  isSignNowConfigured,
  isSignNowRefreshConfigured,
  SignNowNotConfiguredError,
  sendForSignature,
  getSignatureStatus,
  downloadSignedDocument,
  getAccessToken,
  verifyWebhook,
  mapInviteStatusToContract,
} from '../lib/signnow.js';

// Snapshot + restore the SignNow env so tests don't leak into each other.
async function withEnv(vars, fn) {
  const keys = [
    'SIGNNOW_API_KEY', 'SIGNNOW_BASIC_TOKEN', 'SIGNNOW_REFRESH_TOKEN',
    'SIGNNOW_SENDER_EMAIL', 'SIGNNOW_WEBHOOK_SECRET',
  ];
  const prev = {};
  for (const k of keys) prev[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test('isSignNowConfigured reflects SIGNNOW_API_KEY presence', async () => {
  await withEnv({}, () => assert.equal(isSignNowConfigured(), false));
  await withEnv({ SIGNNOW_API_KEY: 'test-key' }, () => assert.equal(isSignNowConfigured(), true));
});

test('isSignNowRefreshConfigured requires basic + refresh token (no password)', async () => {
  await withEnv({ SIGNNOW_API_KEY: 'k' }, () => assert.equal(isSignNowRefreshConfigured(), false));
  await withEnv(
    { SIGNNOW_API_KEY: 'k', SIGNNOW_BASIC_TOKEN: 'YmFzZTY0', SIGNNOW_REFRESH_TOKEN: 'rt' },
    () => assert.equal(isSignNowRefreshConfigured(), true),
  );
});

test('client methods throw SignNowNotConfiguredError when unconfigured (no network)', async () => {
  await withEnv({}, async () => {
    await assert.rejects(() => sendForSignature({ fileBuffer: Buffer.from('x'), filename: 'a.pdf', signers: [{ email: 'a@b.com' }] }), SignNowNotConfiguredError);
    await assert.rejects(() => getSignatureStatus('env_1'), SignNowNotConfiguredError);
    await assert.rejects(() => downloadSignedDocument('env_1'), SignNowNotConfiguredError);
    await assert.rejects(() => getAccessToken(), SignNowNotConfiguredError);
  });
});

test('getAccessToken needs the refresh-token grant even with a bearer key', async () => {
  await withEnv({ SIGNNOW_API_KEY: 'k' }, async () => {
    await assert.rejects(() => getAccessToken(), SignNowNotConfiguredError);
  });
});

test('sendForSignature validates args before any network call', async () => {
  await withEnv({ SIGNNOW_API_KEY: 'k' }, async () => {
    await assert.rejects(() => sendForSignature({ fileBuffer: null, filename: 'a.pdf', signers: [{ email: 'a@b.com' }] }), /fileBuffer is required/);
    await assert.rejects(() => sendForSignature({ fileBuffer: Buffer.from('x'), filename: 'a.pdf', signers: [] }), /at least one signer/);
  });
});

test('mapInviteStatusToContract maps signer states to contract status', () => {
  assert.equal(mapInviteStatusToContract([]), 'sent');
  assert.equal(mapInviteStatusToContract([{ status: 'pending' }, { status: 'pending' }]), 'sent');
  assert.equal(mapInviteStatusToContract([{ status: 'fulfilled' }, { status: 'pending' }]), 'partially_signed');
  assert.equal(mapInviteStatusToContract([{ status: 'fulfilled' }, { status: 'signed' }]), 'signed');
  assert.equal(mapInviteStatusToContract([{ status: 'fulfilled' }, { status: 'declined' }]), 'declined');
  assert.equal(mapInviteStatusToContract([{ status: 'expired' }, { status: 'expired' }]), 'expired');
});

test('verifyWebhook does real HMAC and rejects without a secret', async () => {
  await withEnv({}, () => assert.equal(verifyWebhook('body', 'sig'), false));
  await withEnv({ SIGNNOW_WEBHOOK_SECRET: 'shh' }, () => {
    const body = '{"event":"document.complete"}';
    const good = crypto.createHmac('sha256', 'shh').update(body, 'utf8').digest('base64');
    assert.equal(verifyWebhook(body, good), true);
    assert.equal(verifyWebhook(body, 'wrong'), false);
    assert.equal(verifyWebhook(body, good + 'x'), false); // length mismatch
    assert.equal(verifyWebhook(null, good), false);
  });
});

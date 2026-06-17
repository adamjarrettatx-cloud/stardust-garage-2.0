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
  parseWebhookEnvelopeId,
  parseWebhookContractStatus,
  archivedSignedFilename,
  decideSignedArchive,
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

test('parseWebhookEnvelopeId pulls the document id from varied payload shapes', () => {
  assert.equal(parseWebhookEnvelopeId({ document_id: 'doc_1' }), 'doc_1');
  assert.equal(parseWebhookEnvelopeId({ documentId: 'doc_2' }), 'doc_2');
  assert.equal(parseWebhookEnvelopeId({ entity_id: 'doc_3' }), 'doc_3');
  assert.equal(parseWebhookEnvelopeId({ meta: { document_id: 'doc_4' } }), 'doc_4');
  assert.equal(parseWebhookEnvelopeId({ content: { document_id: 'doc_5' } }), 'doc_5');
  assert.equal(parseWebhookEnvelopeId({ document: { id: 'doc_6' } }), 'doc_6');
  assert.equal(parseWebhookEnvelopeId({ data: { document_id: ' doc_7 ' } }), 'doc_7');
  // Misses / bad input return null (caller acks + skips).
  assert.equal(parseWebhookEnvelopeId({}), null);
  assert.equal(parseWebhookEnvelopeId(null), null);
  assert.equal(parseWebhookEnvelopeId('nope'), null);
  assert.equal(parseWebhookEnvelopeId({ document_id: '' }), null);
});

test('parseWebhookContractStatus maps event names and field_invites to our vocabulary', () => {
  // Explicit field_invites take precedence and defer to mapInviteStatusToContract.
  assert.equal(
    parseWebhookContractStatus({ field_invites: [{ status: 'fulfilled' }, { status: 'signed' }] }),
    'signed',
  );
  assert.equal(
    parseWebhookContractStatus({ content: { field_invites: [{ status: 'fulfilled' }, { status: 'pending' }] } }),
    'partially_signed',
  );
  // Event-name fallbacks.
  assert.equal(parseWebhookContractStatus({ event: 'document.complete' }), 'signed');
  assert.equal(parseWebhookContractStatus({ event_type: 'invite.signer.signed' }), 'signed');
  assert.equal(parseWebhookContractStatus({ event: 'document.fulfilled' }), 'signed');
  assert.equal(parseWebhookContractStatus({ event: 'invite.declined' }), 'declined');
  assert.equal(parseWebhookContractStatus({ event: 'document.expired' }), 'expired');
  // Untracked / missing events return null.
  assert.equal(parseWebhookContractStatus({ event: 'document.update' }), null);
  assert.equal(parseWebhookContractStatus({}), null);
  assert.equal(parseWebhookContractStatus(null), null);
});

test('archivedSignedFilename is canonical + filesystem-safe per envelope', () => {
  assert.equal(archivedSignedFilename('abc123'), 'signnow-signed-abc123.pdf');
  // Unsafe characters are collapsed so the name is a stable storage key.
  assert.equal(archivedSignedFilename('a/b c?d'), 'signnow-signed-a_b_c_d.pdf');
  // Same envelope id -> same name (idempotency depends on this).
  assert.equal(archivedSignedFilename('env_9'), archivedSignedFilename('env_9'));
});

test('decideSignedArchive is idempotent and only fires on fully-signed contracts', () => {
  // Not signed -> never archive.
  assert.deepEqual(
    decideSignedArchive({ status: 'sent', envelopeId: 'e1', existingFilenames: [] }),
    { archive: false, reason: 'contract is not fully signed' },
  );
  // Signed but no envelope -> nothing to download.
  assert.deepEqual(
    decideSignedArchive({ status: 'signed', envelopeId: '', existingFilenames: [] }),
    { archive: false, reason: 'no SignNow envelope id' },
  );
  // Signed, has envelope, not yet archived -> archive.
  const fresh = decideSignedArchive({ status: 'signed', envelopeId: 'e2', existingFilenames: ['contract.pdf'] });
  assert.equal(fresh.archive, true);
  assert.equal(fresh.filename, 'signnow-signed-e2.pdf');
  // Signed, already archived (canonical name present) -> skip (no duplicate).
  const dup = decideSignedArchive({
    status: 'signed', envelopeId: 'e2',
    existingFilenames: ['contract.pdf', 'signnow-signed-e2.pdf'],
  });
  assert.equal(dup.archive, false);
  assert.equal(dup.reason, 'signed PDF already archived');
});

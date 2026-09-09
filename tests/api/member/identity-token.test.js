const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = resolve(__dirname, '../../..');
const serviceUrl = pathToFileURL(resolve(repoRoot, 'lib/member-identity-token-service.mjs'));
const limiterUrl = pathToFileURL(resolve(repoRoot, 'lib/rate-limit-core.mjs'));
const routeSource = readFileSync(resolve(repoRoot, 'app/api/member/identity-token/route.js'), 'utf8');
const NOW = new Date('2026-09-09T22:00:00.000Z');

function makeAdmin({ member, insertError = null, revokeError = null }) {
  const calls = { revokes: [], inserts: [] };
  function chainFor(table) {
    const chain = {
      select() { return chain; }, eq() { return chain; }, is() { return chain; },
      update(values) { calls.revokes.push(values); return chain; },
      insert(values) { calls.inserts.push(values); return Promise.resolve({ error: insertError }); },
      async maybeSingle() { return { data: table === 'member_profiles' ? member : null, error: null }; },
      then(resolveThen) { return Promise.resolve({ error: revokeError }).then(resolveThen); },
    };
    return chain;
  }
  return { admin: { from: chainFor }, calls };
}

async function getService() { return import(`${serviceUrl.href}?v=${randomUUID()}`); }

test('non-member returns not_a_member without minting', async () => {
  const { getOrIssueMemberIdentityToken } = await getService();
  const { admin, calls } = makeAdmin({ member: null });
  const result = await getOrIssueMemberIdentityToken({
    admin, userId: 'user-1', now: NOW,
    mintToken: () => ({ raw: 'should-not-be-used', hash: 'should-not-be-used' }),
  });
  assert.deepEqual(result, { kind: 'not_a_member' });
  assert.equal(calls.inserts.length, 0);
  assert.equal(calls.revokes.length, 0);
});

test('active member mints a 90-day opaque token and persists only its hash', async () => {
  const { getOrIssueMemberIdentityToken } = await getService();
  const { admin, calls } = makeAdmin({ member: { id: 'member-1', is_active: true } });
  const result = await getOrIssueMemberIdentityToken({
    admin, userId: 'user-1', now: NOW,
    mintToken: () => ({ raw: 'raw-new-token', hash: 'hash-new-token' }),
  });
  assert.deepEqual(result, {
    kind: 'ok', token: 'raw-new-token',
    issuedAt: '2026-09-09T22:00:00.000Z', expiresAt: '2026-12-08T22:00:00.000Z',
  });
  assert.deepEqual(calls.revokes, [{ revoked_at: '2026-09-09T22:00:00.000Z', rotated_at: '2026-09-09T22:00:00.000Z' }]);
  assert.deepEqual(calls.inserts, [{
    member_profile_id: 'member-1', token_hash: 'hash-new-token',
    issued_at: '2026-09-09T22:00:00.000Z', expires_at: '2026-12-08T22:00:00.000Z', revoked_at: null,
  }]);
  assert.equal(Object.hasOwn(calls.inserts[0], 'token_raw'), false);
});

test('every later request rotates because a raw token cannot be reconstructed from a hash', async () => {
  const { getOrIssueMemberIdentityToken } = await getService();
  const { admin, calls } = makeAdmin({ member: { id: 'member-1', is_active: true } });
  const result = await getOrIssueMemberIdentityToken({
    admin, userId: 'user-1', now: NOW,
    mintToken: () => ({ raw: 'replacement-token', hash: 'replacement-hash' }),
  });
  assert.equal(result.token, 'replacement-token');
  assert.equal(calls.revokes.length, 1);
  assert.equal(calls.inserts.length, 1);
});

test('a failed revoke does not mint or insert a new credential', async () => {
  const { getOrIssueMemberIdentityToken } = await getService();
  const { admin, calls } = makeAdmin({ member: { id: 'member-1', is_active: true }, revokeError: new Error('db down') });
  const result = await getOrIssueMemberIdentityToken({
    admin, userId: 'user-1', now: NOW,
    mintToken: () => { throw new Error('must not mint'); },
  });
  assert.equal(result.kind, 'error');
  assert.equal(calls.inserts.length, 0);
});

test('21st request is rate limited with a retry-after value', async () => {
  const { applyRateLimit } = await import(limiterUrl.href);
  const key = `member_identity_token:${randomUUID()}`;
  let result;
  for (let request = 1; request <= 21; request += 1) {
    result = applyRateLimit({ key, limit: 20, windowMs: 60 * 60 * 1000 });
    if (request <= 20) assert.equal(result.ok, true);
  }
  assert.equal(result.ok, false);
  assert.ok(result.retryAfterSeconds > 0);
});

test('route uses bearer-authenticated caller, user-scoped limiting, and the mobile response keys', () => {
  assert.match(routeSource, /getRequestUser\(request\)/);
  assert.match(routeSource, /member_identity_token:\$\{user\.id\}/);
  assert.match(routeSource, /MEMBER_IDENTITY_TOKEN_RATE_LIMIT/);
  assert.match(routeSource, /'Retry-After'/);
  assert.match(routeSource, /error: 'not_a_member'/);
  assert.match(routeSource, /token: result\.token/);
});

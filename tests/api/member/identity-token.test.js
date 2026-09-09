const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = resolve(__dirname, '../../..');
const serviceUrl = pathToFileURL(resolve(repoRoot, 'lib/member-identity-token-service.mjs'));
const limiterUrl = pathToFileURL(resolve(repoRoot, 'lib/rate-limit-core.mjs'));
const routeSource = readFileSync(
  resolve(repoRoot, 'app/api/member/identity-token/route.js'),
  'utf8',
);

const NOW = new Date('2026-09-09T22:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function makeAdmin({ member, tokenReads = [], insertError = null }) {
  const calls = { revokes: [], inserts: [], tokenReads: 0 };
  const readQueue = [...tokenReads];

  function chainFor(table) {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      is() { return chain; },
      gt() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      async maybeSingle() {
        if (table === 'member_profiles') return { data: member, error: null };
        calls.tokenReads += 1;
        return { data: readQueue.shift() || null, error: null };
      },
      update(values) {
        calls.revokes.push(values);
        return chain;
      },
      insert(values) {
        calls.inserts.push(values);
        return Promise.resolve({ error: insertError });
      },
      then(resolve) {
        if (table === 'member_identity_tokens' && calls.revokes.length) {
          return Promise.resolve({ error: null }).then(resolve);
        }
        return Promise.resolve({ error: null }).then(resolve);
      },
    };
    return chain;
  }

  return { admin: { from: chainFor }, calls };
}

async function getService() {
  return import(serviceUrl.href);
}

test('non-member returns not_a_member without minting', async () => {
  const { getOrIssueMemberIdentityToken } = await getService();
  const { admin, calls } = makeAdmin({ member: null });

  const result = await getOrIssueMemberIdentityToken({
    admin,
    userId: 'user-1',
    now: NOW,
    mintToken: () => ({ raw: 'should-not-be-used', hash: 'should-not-be-used' }),
  });

  assert.deepEqual(result, { kind: 'not_a_member' });
  assert.equal(calls.inserts.length, 0);
  assert.equal(calls.revokes.length, 0);
});

test('active member without a token mints a 90-day opaque token', async () => {
  const { getOrIssueMemberIdentityToken } = await getService();
  const { admin, calls } = makeAdmin({
    member: { id: 'member-1', is_active: true },
    tokenReads: [null],
  });

  const result = await getOrIssueMemberIdentityToken({
    admin,
    userId: 'user-1',
    now: NOW,
    mintToken: () => ({ raw: 'raw-new-token', hash: 'hash-new-token' }),
  });

  assert.deepEqual(result, {
    kind: 'ok',
    token: 'raw-new-token',
    issuedAt: '2026-09-09T22:00:00.000Z',
    expiresAt: '2026-12-08T22:00:00.000Z',
  });
  assert.equal(calls.revokes.length, 1);
  assert.deepEqual(calls.inserts, [{
    member_profile_id: 'member-1',
    token_hash: 'hash-new-token',
    token_raw: 'raw-new-token',
    issued_at: '2026-09-09T22:00:00.000Z',
    expires_at: '2026-12-08T22:00:00.000Z',
    revoked_at: null,
  }]);
});

test('active member with a token valid for more than one hour gets the same token', async () => {
  const { getOrIssueMemberIdentityToken } = await getService();
  const { admin, calls } = makeAdmin({
    member: { id: 'member-1', is_active: true },
    tokenReads: [{
      token_raw: 'existing-token',
      issued_at: '2026-09-01T00:00:00.000Z',
      expires_at: '2026-09-10T00:00:01.000Z',
    }],
  });

  const result = await getOrIssueMemberIdentityToken({
    admin,
    userId: 'user-1',
    now: NOW,
    mintToken: () => {
      throw new Error('valid token must not be rotated');
    },
  });

  assert.deepEqual(result, {
    kind: 'ok',
    token: 'existing-token',
    issuedAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2026-09-10T00:00:01.000Z',
  });
  assert.equal(calls.revokes.length, 0);
  assert.equal(calls.inserts.length, 0);
});

test('token expiring inside one hour is revoked and replaced', async () => {
  const { getOrIssueMemberIdentityToken } = await getService();
  const { admin, calls } = makeAdmin({
    member: { id: 'member-1', is_active: true },
    tokenReads: [{
      token_raw: 'nearly-expired-token',
      issued_at: '2026-06-11T22:00:00.000Z',
      expires_at: new Date(NOW.getTime() + HOUR - 1).toISOString(),
    }],
  });

  const result = await getOrIssueMemberIdentityToken({
    admin,
    userId: 'user-1',
    now: NOW,
    mintToken: () => ({ raw: 'replacement-token', hash: 'replacement-hash' }),
  });

  assert.equal(result.token, 'replacement-token');
  assert.equal(calls.revokes.length, 1);
  assert.equal(calls.revokes[0].revoked_at, '2026-09-09T22:00:00.000Z');
  assert.equal(calls.inserts.length, 1);
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
  assert.match(routeSource, /expiresAt: result\.expiresAt/);
  assert.match(routeSource, /issuedAt: result\.issuedAt/);
});

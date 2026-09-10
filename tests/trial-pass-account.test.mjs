import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTrialPassProfileUrl,
  createTrialPassProfileLink,
  ensureTrialPassAccount,
  findAuthUserByEmail,
  normalizeAccountEmail,
} from '../lib/trial-pass-account.js';

// lib/trial-pass-account.js is the account half of a front-desk-issued Trial
// SDG Pass. Everything it does is enrichment around a pass that has to be
// issued regardless, and every rule below is one we can get wrong silently:
//
//   * reuse before create — staff type real people's addresses by hand and a
//     collision with an existing member/staff account must never mutate it;
//   * idempotent under a double-tap on the front-desk tablet;
//   * never throws — the caller treats a null userId as "pass only".
//
// It takes the service-role client as an argument and imports nothing
// server-only (same shape as lib/partner-identity.js), so these are real unit
// tests against a fake admin client rather than source-string assertions.

// ---------------------------------------------------------------------------
// Fake admin client
// ---------------------------------------------------------------------------

function makeAdmin({ users = [], createBehaviour = 'ok', listError = null, generateLink } = {}) {
  const calls = { listUsers: [], createUser: [], generateLink: [] };
  const state = { users: [...users], nextId: 1 };

  const admin = {
    calls,
    state,
    auth: {
      admin: {
        async listUsers({ page = 1, perPage = 50 } = {}) {
          calls.listUsers.push({ page, perPage });
          if (listError) return { data: null, error: listError };
          const start = (page - 1) * perPage;
          return { data: { users: state.users.slice(start, start + perPage) }, error: null };
        },
        async createUser(payload) {
          calls.createUser.push(payload);
          if (createBehaviour === 'throw') throw new Error('auth is down');
          const clash = state.users.find(
            (u) => u.email?.toLowerCase() === String(payload.email).toLowerCase(),
          );
          if (clash || createBehaviour === 'duplicate') {
            return { data: null, error: { code: 'user_already_exists', message: 'already registered' } };
          }
          if (createBehaviour === 'no_id') return { data: { user: {} }, error: null };
          const user = { id: `usr_${state.nextId += 1}`, email: payload.email, metadata: payload.user_metadata };
          state.users.push(user);
          return { data: { user }, error: null };
        },
        generateLink: generateLink || (async ({ type, email }) => {
          calls.generateLink.push({ type, email });
          return { data: { properties: { hashed_token: 'hash_abc' } }, error: null };
        }),
      },
    },
  };
  return admin;
}

// ---------------------------------------------------------------------------
// normalizeAccountEmail
// ---------------------------------------------------------------------------

test('normalizeAccountEmail lowercases, trims, and nulls out junk', () => {
  assert.equal(normalizeAccountEmail('  Jane@Email.COM '), 'jane@email.com');
  assert.equal(normalizeAccountEmail(''), null);
  assert.equal(normalizeAccountEmail('   '), null);
  assert.equal(normalizeAccountEmail(undefined), null);
  assert.equal(normalizeAccountEmail(42), null);
});

// ---------------------------------------------------------------------------
// findAuthUserByEmail
// ---------------------------------------------------------------------------

test('findAuthUserByEmail matches case-insensitively', async () => {
  const admin = makeAdmin({ users: [{ id: 'usr_1', email: 'adam@sdgatx.com' }] });
  const found = await findAuthUserByEmail(admin, '  ADAM@sdgatx.com ');
  assert.equal(found.id, 'usr_1');
});

test('findAuthUserByEmail pages past the first page', async () => {
  // 200 is the page size; the target sits on page two, which a single
  // perPage-capped listUsers call would miss entirely.
  const users = Array.from({ length: 250 }, (_, i) => ({ id: `usr_${i}`, email: `guest${i}@email.com` }));
  const admin = makeAdmin({ users });
  const found = await findAuthUserByEmail(admin, 'guest240@email.com');
  assert.equal(found.id, 'usr_240');
  assert.equal(admin.calls.listUsers.length, 2);
});

test('findAuthUserByEmail stops on a short page instead of looping', async () => {
  const admin = makeAdmin({ users: [{ id: 'usr_1', email: 'someone@email.com' }] });
  assert.equal(await findAuthUserByEmail(admin, 'nobody@email.com'), null);
  assert.equal(admin.calls.listUsers.length, 1);
});

test('findAuthUserByEmail returns null for a blank email without calling Auth', async () => {
  const admin = makeAdmin();
  assert.equal(await findAuthUserByEmail(admin, ''), null);
  assert.equal(admin.calls.listUsers.length, 0);
});

// ---------------------------------------------------------------------------
// ensureTrialPassAccount
// ---------------------------------------------------------------------------

test('creates an account when the email is new', async () => {
  const admin = makeAdmin();
  const res = await ensureTrialPassAccount(admin, { email: 'Jane@Email.com', fullName: 'Jane Doe' });
  assert.equal(res.created, true);
  assert.equal(res.reused, false);
  assert.equal(res.error, null);
  assert.ok(res.userId);
  assert.deepEqual(admin.calls.createUser, [{
    email: 'jane@email.com',
    email_confirm: true,
    user_metadata: { full_name: 'Jane Doe' },
  }]);
});

test('never sends a phone or a password when creating the account', async () => {
  // The manual path exists for guests whose phone could NOT be verified, so
  // claiming phone_confirm would be a lie; and no credential should travel
  // through the front desk.
  const admin = makeAdmin();
  await ensureTrialPassAccount(admin, { email: 'jane@email.com', fullName: 'Jane' });
  const payload = admin.calls.createUser[0];
  assert.equal('phone' in payload, false);
  assert.equal('phone_confirm' in payload, false);
  assert.equal('password' in payload, false);
  assert.equal(payload.email_confirm, true);
});

test('reuses an existing account and never calls createUser on it', async () => {
  // Adam signs in as adam@sdgatx.com. A staff member typing that address at
  // the front desk must not touch his account.
  const admin = makeAdmin({ users: [{ id: 'usr_adam', email: 'adam@sdgatx.com' }] });
  const res = await ensureTrialPassAccount(admin, { email: 'Adam@SDGatx.com', fullName: 'Not Adam' });
  assert.deepEqual(res, { userId: 'usr_adam', created: false, reused: true, error: null });
  assert.equal(admin.calls.createUser.length, 0);
});

test('is idempotent — a second issue for the same email reuses the first account', async () => {
  const admin = makeAdmin();
  const first = await ensureTrialPassAccount(admin, { email: 'jane@email.com', fullName: 'Jane Doe' });
  const second = await ensureTrialPassAccount(admin, { email: 'jane@email.com', fullName: 'Jane Doe' });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.reused, true);
  assert.equal(second.userId, first.userId);
  assert.equal(admin.state.users.length, 1);
});

test('recovers from a lost create race by looking the winner up again', async () => {
  // listUsers says "no such user", createUser says "already registered" —
  // this is the double-tap where the other request got there first.
  const admin = makeAdmin({ createBehaviour: 'duplicate' });
  admin.auth.admin.listUsers = async ({ page = 1 } = {}) => {
    admin.calls.listUsers.push({ page });
    if (admin.calls.listUsers.length === 1) return { data: { users: [] }, error: null };
    return { data: { users: [{ id: 'usr_race', email: 'jane@email.com' }] }, error: null };
  };
  const res = await ensureTrialPassAccount(admin, { email: 'jane@email.com', fullName: 'Jane' });
  assert.deepEqual(res, { userId: 'usr_race', created: false, reused: true, error: null });
});

test('reports an unrecoverable create failure instead of throwing', async () => {
  const admin = makeAdmin({ createBehaviour: 'duplicate' });
  const res = await ensureTrialPassAccount(admin, { email: 'jane@email.com', fullName: 'Jane' });
  assert.equal(res.userId, null);
  assert.equal(res.created, false);
  assert.match(res.error, /already registered/);
});

test('swallows a thrown Auth error and reports it', async () => {
  const admin = makeAdmin({ createBehaviour: 'throw' });
  const res = await ensureTrialPassAccount(admin, { email: 'jane@email.com', fullName: 'Jane' });
  assert.deepEqual(res, { userId: null, created: false, reused: false, error: 'auth is down' });
});

test('reports a listUsers failure without throwing', async () => {
  const admin = makeAdmin({ listError: { message: 'service role rejected' } });
  const res = await ensureTrialPassAccount(admin, { email: 'jane@email.com', fullName: 'Jane' });
  assert.equal(res.userId, null);
  assert.equal(res.error, 'service role rejected');
});

test('returns a no-op result for a missing email or client', async () => {
  const admin = makeAdmin();
  const noEmail = await ensureTrialPassAccount(admin, { email: '', fullName: 'Jane' });
  assert.deepEqual(noEmail, { userId: null, created: false, reused: false, error: 'missing_email_or_client' });
  const noClient = await ensureTrialPassAccount({}, { email: 'jane@email.com' });
  assert.equal(noClient.userId, null);
  assert.equal(admin.calls.createUser.length, 0);
});

test('handles a createUser response that carries no user id', async () => {
  const admin = makeAdmin({ createBehaviour: 'no_id' });
  const res = await ensureTrialPassAccount(admin, { email: 'jane@email.com', fullName: 'Jane' });
  assert.deepEqual(res, { userId: null, created: false, reused: false, error: 'missing_user_id' });
});

// ---------------------------------------------------------------------------
// buildTrialPassProfileUrl / createTrialPassProfileLink
// ---------------------------------------------------------------------------

test('the profile link points at OUR host, never supabase.co', () => {
  // Same rule as buildPartnerActivationUrl: Supabase's own action_link only
  // honours redirect_to values on the project allow list, so Vercel preview
  // hosts get bounced to production.
  const url = buildTrialPassProfileUrl('https://sdgatx.com/', 'hash_abc');
  assert.equal(
    url,
    'https://sdgatx.com/auth/callback?token_hash=hash_abc&type=magiclink&next=%2Faccount%2Ftickets',
  );
  assert.equal(url.includes('supabase.co'), false);
});

test('the profile link url-encodes the token and the next path', () => {
  const url = buildTrialPassProfileUrl('https://sdgatx.com', 'a+b/c=', '/account/tickets?x=1');
  assert.match(url, /token_hash=a%2Bb%2Fc%3D/);
  assert.match(url, /next=%2Faccount%2Ftickets%3Fx%3D1/);
});

test('the profile link is null without a site url or a token', () => {
  assert.equal(buildTrialPassProfileUrl('', 'hash'), null);
  assert.equal(buildTrialPassProfileUrl('https://sdgatx.com', ''), null);
});

test('createTrialPassProfileLink mints a magiclink for the normalized email', async () => {
  const admin = makeAdmin();
  const res = await createTrialPassProfileLink(admin, {
    email: ' Jane@Email.com ',
    siteUrl: 'https://sdgatx.com',
  });
  assert.equal(res.error, null);
  assert.match(res.url, /token_hash=hash_abc/);
  assert.deepEqual(admin.calls.generateLink, [{ type: 'magiclink', email: 'jane@email.com' }]);
});

test('createTrialPassProfileLink reports a generateLink failure without throwing', async () => {
  const admin = makeAdmin({
    generateLink: async () => ({ data: null, error: { message: 'rate limited' } }),
  });
  const res = await createTrialPassProfileLink(admin, { email: 'jane@email.com', siteUrl: 'https://sdgatx.com' });
  assert.deepEqual(res, { url: null, error: 'rate limited' });
});

test('createTrialPassProfileLink reports a missing hashed_token', async () => {
  const admin = makeAdmin({ generateLink: async () => ({ data: { properties: {} }, error: null }) });
  const res = await createTrialPassProfileLink(admin, { email: 'jane@email.com', siteUrl: 'https://sdgatx.com' });
  assert.deepEqual(res, { url: null, error: 'no_hashed_token' });
});

test('createTrialPassProfileLink swallows a thrown Auth error', async () => {
  const admin = makeAdmin({ generateLink: async () => { throw new Error('boom'); } });
  const res = await createTrialPassProfileLink(admin, { email: 'jane@email.com', siteUrl: 'https://sdgatx.com' });
  assert.deepEqual(res, { url: null, error: 'boom' });
});

test('createTrialPassProfileLink no-ops without an email or a site url', async () => {
  const admin = makeAdmin();
  assert.equal((await createTrialPassProfileLink(admin, { email: '', siteUrl: 'https://x.com' })).url, null);
  assert.equal((await createTrialPassProfileLink(admin, { email: 'a@b.com', siteUrl: '' })).url, null);
  assert.equal(admin.calls.generateLink.length, 0);
});

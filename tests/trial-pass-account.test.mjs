import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTrialPassProfileUrl,
  claimTrialProvisionedAccount,
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

function makeAdmin({ passes = [], users = [], createBehaviour = 'ok', listError = null, generateLink } = {}) {
  const calls = { rpc: [], createUser: [], updateUserById: [], generateLink: [] };
  const state = { users: [...users], passes: [...passes], nextId: 1 };

  const admin = {
    calls,
    state,
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      if (listError) return { data: null, error: listError };
      const u = state.users.find((x) => x.email?.toLowerCase() === String(args.p_email).toLowerCase());
      return {
        data: u ? [{ id: u.id, has_password: Boolean(u.password), trial_provisioned: u.metadata?.provisioned_by === 'trial_pass' }] : [],
        error: null,
      };
    },
    from() {
      const q = {
        select() { return q; },
        eq(col, val) { q._f = [...(q._f || []), [col, val]]; return q; },
        async limit() {
          const rows = state.passes.filter((p) => (q._f || []).every(([c, v]) => p[c] === v));
          return { data: rows, error: null };
        },
      };
      return q;
    },
    auth: {
      admin: {
        async updateUserById(id, attrs) {
          calls.updateUserById.push({ id, attrs });
          const u = state.users.find((x) => x.id === id);
          if (attrs.password) u.password = attrs.password;
          return { data: { user: u }, error: null };
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

test('findAuthUserByEmail uses the auth_user_by_email RPC, not listUsers', async () => {
  // listUsers() failed in production with "Database error finding users".
  const admin = makeAdmin({ users: [{ id: 'usr_9', email: 'guest@email.com' }] });
  const found = await findAuthUserByEmail(admin, 'Guest@Email.com');
  assert.equal(found.id, 'usr_9');
  assert.deepEqual(admin.calls.rpc, [{ name: 'auth_user_by_email', args: { p_email: 'guest@email.com' } }]);
});

test('findAuthUserByEmail returns null when nobody matches', async () => {
  const admin = makeAdmin({ users: [{ id: 'usr_1', email: 'someone@email.com' }] });
  assert.equal(await findAuthUserByEmail(admin, 'nobody@email.com'), null);
});

test('findAuthUserByEmail returns null for a blank email without calling Auth', async () => {
  const admin = makeAdmin();
  assert.equal(await findAuthUserByEmail(admin, ''), null);
  assert.equal(admin.calls.rpc.length, 0);
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
    user_metadata: { full_name: 'Jane Doe', provisioned_by: 'trial_pass' },
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
  // The lookup says "no such user", createUser says "already registered" —
  // this is the double-tap where the other request got there first.
  const admin = makeAdmin({ createBehaviour: 'duplicate' });
  const realRpc = admin.rpc.bind(admin);
  let n = 0;
  admin.rpc = async (name, args) => {
    n += 1;
    if (n === 1) return { data: [], error: null };
    admin.state.users = [{ id: 'usr_race', email: 'jane@email.com' }];
    return realRpc(name, args);
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

test('reports a lookup failure without throwing', async () => {
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

// ---------------------------------------------------------------------------
// claimTrialProvisionedAccount
// ---------------------------------------------------------------------------

const trialUser = () => ({ id: 'usr_t', email: 'guest@email.com', metadata: { provisioned_by: 'trial_pass' } });
const trialPass = { user_id: 'usr_t', phone: '+15125550100' };

test('claim sets a password on a passwordless trial account when the phone matches its pass', async () => {
  const admin = makeAdmin({ users: [trialUser()], passes: [trialPass] });
  const res = await claimTrialProvisionedAccount(admin, {
    email: 'Guest@Email.com', phone: '+15125550100', password: 'hunter2hunter2', fullName: 'Guest One',
  });
  assert.deepEqual(res, { claimed: true, userId: 'usr_t', reason: null });
  assert.equal(admin.calls.updateUserById[0].attrs.password, 'hunter2hunter2');
});

test('claim refuses when the phone does not match the pass', async () => {
  const admin = makeAdmin({ users: [trialUser()], passes: [trialPass] });
  const res = await claimTrialProvisionedAccount(admin, { email: 'guest@email.com', phone: '+15125559999', password: 'x'.repeat(8) });
  assert.equal(res.claimed, false);
  assert.equal(res.reason, 'phone_mismatch');
  assert.equal(admin.calls.updateUserById.length, 0);
});

test('claim refuses an account that already has a password', async () => {
  const admin = makeAdmin({ users: [{ ...trialUser(), password: 'set' }], passes: [trialPass] });
  const res = await claimTrialProvisionedAccount(admin, { email: 'guest@email.com', phone: '+15125550100', password: 'x'.repeat(8) });
  assert.equal(res.reason, 'password_already_set');
  assert.equal(admin.calls.updateUserById.length, 0);
});

test('claim refuses an account this platform did not provision for a trial', async () => {
  const admin = makeAdmin({ users: [{ id: 'usr_t', email: 'guest@email.com' }], passes: [trialPass] });
  const res = await claimTrialProvisionedAccount(admin, { email: 'guest@email.com', phone: '+15125550100', password: 'x'.repeat(8) });
  assert.equal(res.reason, 'not_trial_provisioned');
});

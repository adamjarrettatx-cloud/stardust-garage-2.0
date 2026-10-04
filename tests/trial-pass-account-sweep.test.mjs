import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepUnlinkedTrialPasses } from '../lib/trial-pass-account-sweep.js';

// The sweep gives every unlinked Trial SDG Pass an account. These pin the
// three rules that matter: backfill only (never move a linked pass), link to
// an existing account rather than create a duplicate, and stamp failures so
// they are not retried every run.

function makeAdmin({ passes, users = [], createFails = new Set() }) {
  const state = { passes: passes.map((p) => ({ ...p })), users: [...users], created: [] };
  const admin = {
    state,
    async rpc(_name, { p_email }) {
      const u = state.users.find((x) => x.email === p_email);
      return { data: u ? [{ id: u.id, has_password: true, trial_provisioned: false }] : [], error: null };
    },
    auth: {
      admin: {
        async createUser({ email }) {
          if (createFails.has(email)) return { data: null, error: { message: 'Unable to validate email address' } };
          const user = { id: `new_${email}`, email };
          state.users.push(user);
          state.created.push(email);
          return { data: { user }, error: null };
        },
      },
    },
    from() {
      let mode = 'select';
      let patch = null;
      const filters = [];
      const q = {
        select() { return q; },
        update(p) { mode = 'update'; patch = p; return q; },
        is(col, val) { filters.push((r) => (r[col] ?? null) === val); return q; },
        eq(col, val) { filters.push((r) => r[col] === val); return q; },
        or() { filters.push((r) => !r.account_link_attempted_at); return q; },
        order() { return q; },
        async limit(n) {
          return { data: state.passes.filter((r) => filters.every((f) => f(r))).slice(0, n), error: null };
        },
        then(resolve) {
          const rows = state.passes.filter((r) => filters.every((f) => f(r)));
          if (mode === 'update') rows.forEach((r) => Object.assign(r, patch));
          resolve({ data: rows.map((r) => ({ id: r.id })), error: null });
        },
      };
      return q;
    },
  };
  return admin;
}

test('creates accounts for unlinked passes, links existing ones, skips linked', async () => {
  const admin = makeAdmin({
    passes: [
      { id: 'p1', email: 'new@email.com', full_name: 'New Guest', user_id: null },
      { id: 'p2', email: 'member@email.com', full_name: 'Member', user_id: null },
      { id: 'p3', email: 'linked@email.com', full_name: 'Linked', user_id: 'usr_linked' },
    ],
    users: [{ id: 'usr_member', email: 'member@email.com' }],
  });
  const res = await sweepUnlinkedTrialPasses(admin, { now: new Date('2026-10-04T05:00:00Z') });
  assert.deepEqual(res, { scanned: 2, created: 1, linkedExisting: 1, failed: 0 });
  const byId = Object.fromEntries(admin.state.passes.map((p) => [p.id, p]));
  assert.equal(byId.p1.user_id, 'new_new@email.com');
  assert.equal(byId.p2.user_id, 'usr_member');
  assert.equal(byId.p3.user_id, 'usr_linked');
  assert.deepEqual(admin.state.created, ['new@email.com']);
});

test('stamps a failure and does not pick it up again in the next run', async () => {
  const admin = makeAdmin({
    passes: [{ id: 'p1', email: 'bad@email', full_name: 'Bad', user_id: null }],
    createFails: new Set(['bad@email']),
  });
  const first = await sweepUnlinkedTrialPasses(admin);
  assert.equal(first.failed, 1);
  assert.match(admin.state.passes[0].account_link_error, /validate email/);
  assert.ok(admin.state.passes[0].account_link_attempted_at);
  const second = await sweepUnlinkedTrialPasses(admin);
  assert.equal(second.scanned, 0);
});

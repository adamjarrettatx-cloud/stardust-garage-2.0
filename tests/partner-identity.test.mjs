import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInviteEmail,
  findPartnerByInvitedEmail,
  relinkPartnerToUser,
} from '../lib/partner-identity.js';
import { GUESTLIST_AUDIT_ACTIONS } from '../lib/guestlist-helpers.js';

// Minimal stand-in for the service-role client. Records what was asked for so
// the tests can assert on the query as well as the result.
function fakeAdmin({ row = null, selectError = null, updateError = null, audit = {} } = {}) {
  const calls = { table: null, filter: null, updated: null, auditRow: null };

  return {
    calls,
    from(table) {
      calls.table = calls.table || table;
      if (table === 'guestlist_audit_log') {
        return {
          insert: async (values) => {
            calls.auditRow = values;
            return { data: null, error: null };
          },
        };
      }
      return {
        select: () => ({
          eq: (column, value) => {
            calls.filter = { column, value };
            return { maybeSingle: async () => ({ data: row, error: selectError }) };
          },
        }),
        update: (values) => ({
          eq: (column, value) => {
            calls.updated = { values, column, value };
            return Promise.resolve({ data: null, error: updateError });
          },
        }),
      };
    },
    ...audit,
  };
}

test('normalizeInviteEmail folds case and whitespace, and rejects empties', () => {
  assert.equal(normalizeInviteEmail('  Promoter@Example.COM '), 'promoter@example.com');
  assert.equal(normalizeInviteEmail(''), null);
  assert.equal(normalizeInviteEmail('   '), null);
  assert.equal(normalizeInviteEmail(undefined), null);
  assert.equal(normalizeInviteEmail(null), null);
});

test('findPartnerByInvitedEmail matches the normalized address, not the raw one', async () => {
  const admin = fakeAdmin({ row: { id: 'p1', user_id: 'invite-user' } });

  const profile = await findPartnerByInvitedEmail(admin, ' Promoter@Example.COM ');

  assert.equal(admin.calls.table, 'partner_profiles');
  assert.deepEqual(admin.calls.filter, { column: 'invited_email', value: 'promoter@example.com' });
  assert.equal(profile.id, 'p1');
});

test('findPartnerByInvitedEmail returns null rather than throwing on a bad email or a query error', async () => {
  assert.equal(await findPartnerByInvitedEmail(fakeAdmin(), ''), null);
  assert.equal(
    await findPartnerByInvitedEmail(fakeAdmin({ selectError: { message: 'boom' } }), 'a@b.com'),
    null
  );
});

test('relinkPartnerToUser leaves the row alone when the session already owns it', async () => {
  const admin = fakeAdmin();
  const profile = { id: 'p1', user_id: 'same-user', contact_id: 'c1', invited_email: 'a@b.com' };

  const result = await relinkPartnerToUser({ admin, profile, userId: 'same-user' });

  assert.deepEqual(result, { relinked: false, error: null });
  assert.equal(admin.calls.updated, null, 'the ordinary sign-in must not write to partner_profiles');
  assert.equal(admin.calls.auditRow, null, 'and must not churn the audit log');
});

test('relinkPartnerToUser re-points the profile at the identity that actually signed in', async () => {
  const admin = fakeAdmin();
  const profile = {
    id: 'p1',
    user_id: 'magic-link-user',
    contact_id: 'c1',
    invited_email: 'promoter@example.com',
  };

  const result = await relinkPartnerToUser({
    admin,
    profile,
    userId: 'google-user',
    userEmail: 'promoter@example.com',
  });

  assert.deepEqual(result, { relinked: true, error: null });
  assert.deepEqual(admin.calls.updated, {
    values: { user_id: 'google-user' },
    column: 'id',
    value: 'p1',
  });
});

test('a re-point is audited with both the old and the new identity', async () => {
  const admin = fakeAdmin();
  const profile = {
    id: 'p1',
    user_id: 'magic-link-user',
    contact_id: 'c1',
    invited_email: 'promoter@example.com',
  };

  await relinkPartnerToUser({
    admin,
    profile,
    userId: 'google-user',
    userEmail: 'promoter@example.com',
    request: {
      headers: {
        get: (name) =>
          ({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18', 'user-agent': 'Mozilla/5.0' }[name] ||
          null),
      },
    },
  });

  assert.equal(admin.calls.auditRow.action, 'partner_identity_relinked');
  assert.equal(admin.calls.auditRow.actor_id, 'google-user');
  assert.equal(admin.calls.auditRow.ip_address, '203.0.113.7');
  assert.deepEqual(admin.calls.auditRow.details, {
    partner_profile_id: 'p1',
    contact_id: 'c1',
    invited_email: 'promoter@example.com',
    previous_user_id: 'magic-link-user',
    new_user_id: 'google-user',
  });
});

test('partner_identity_relinked is a real audit action, matching the check constraint', () => {
  assert.ok(GUESTLIST_AUDIT_ACTIONS.includes('partner_identity_relinked'));
});

test('a unique-violation on user_id surfaces as an error, never a silent success', async () => {
  // user_id is unique, so this fires when the Google account is already the
  // login for a different contact. The callers sign the user out on this.
  const admin = fakeAdmin({ updateError: { message: 'duplicate key value', code: '23505' } });
  const profile = { id: 'p1', user_id: 'other-user', contact_id: 'c1', invited_email: 'a@b.com' };

  const result = await relinkPartnerToUser({ admin, profile, userId: 'google-user' });

  assert.equal(result.relinked, false);
  assert.equal(result.error.code, '23505');
  assert.equal(admin.calls.auditRow, null, 'a failed re-point is not an audit event');
});

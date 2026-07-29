import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMP_TYPE_OPTIONS,
  ENTRY_STATUS_OPTIONS,
  GUESTLIST_AUDIT_ACTIONS,
  compTypeLabel,
  entryStatusLabel,
  auditGuestlist,
} from '../lib/guestlist-helpers.js';

// The three lists below are duplicated as CHECK constraints in
// 20260729_guest_list_partners.sql. If one side changes the other has to.
test('comp types match the event_guestlist_entries.comp_type constraint', () => {
  assert.deepEqual(COMP_TYPE_OPTIONS.map((o) => o.value), ['free', 'discount']);
});

test('entry statuses match the event_guestlist_entries.status constraint', () => {
  assert.deepEqual(
    ENTRY_STATUS_OPTIONS.map((o) => o.value),
    ['pending', 'checked_in', 'no_show']
  );
});

test('audit actions match the guestlist_audit_log.action constraint', () => {
  assert.deepEqual(GUESTLIST_AUDIT_ACTIONS, [
    'grant_created',
    'grant_updated',
    'grant_revoked',
    'entry_added',
    'entry_removed',
    'checked_in',
  ]);
});

test('label helpers fall back to the raw value', () => {
  assert.equal(compTypeLabel('discount'), 'Discounted entry');
  assert.equal(compTypeLabel('mystery'), 'mystery');
  assert.equal(entryStatusLabel('checked_in'), 'Checked in');
  assert.equal(entryStatusLabel('mystery'), 'mystery');
});

function fakeAdmin(captured) {
  return {
    from(table) {
      captured.table = table;
      return {
        insert(row) {
          captured.row = row;
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

function fakeRequest(headers) {
  return { headers: { get: (name) => headers[name] ?? null } };
}

test('auditGuestlist pulls ip and user agent off the request, not the caller', async () => {
  const captured = {};
  await auditGuestlist({
    admin: fakeAdmin(captured),
    action: 'entry_added',
    grantId: 'grant-1',
    entryId: 'entry-1',
    actorId: 'user-1',
    actorEmail: 'promoter@example.com',
    request: fakeRequest({
      'x-forwarded-for': '203.0.113.7, 70.41.3.18',
      'user-agent': 'Mozilla/5.0',
    }),
    details: { guest_name: 'Ada' },
  });

  assert.equal(captured.table, 'guestlist_audit_log');
  assert.deepEqual(captured.row, {
    action: 'entry_added',
    grant_id: 'grant-1',
    entry_id: 'entry-1',
    actor_id: 'user-1',
    actor_email: 'promoter@example.com',
    ip_address: '203.0.113.7',
    user_agent: 'Mozilla/5.0',
    details: { guest_name: 'Ada' },
  });
});

test('auditGuestlist tolerates a missing request and swallows insert failures', async () => {
  const captured = {};
  await auditGuestlist({
    admin: fakeAdmin(captured),
    action: 'grant_created',
    grantId: 'grant-1',
    actorId: 'user-1',
    actorEmail: 'admin@sdgatx.com',
  });
  assert.equal(captured.row.ip_address, null);
  assert.equal(captured.row.user_agent, null);
  assert.equal(captured.row.entry_id, null);
  assert.equal(captured.row.details, null);

  const throwingAdmin = {
    from() {
      throw new Error('table missing');
    },
  };
  await auditGuestlist({ admin: throwingAdmin, action: 'checked_in', grantId: 'g' });
});

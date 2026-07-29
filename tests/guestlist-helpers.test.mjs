import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMP_TYPE_OPTIONS,
  ENTRY_STATUS_OPTIONS,
  GUESTLIST_AUDIT_ACTIONS,
  compTypeLabel,
  entryStatusLabel,
  auditGuestlist,
  countGrantUsage,
  validateGrantSlots,
  buildGrantPayload,
  grantRevokeBlockedMessage,
  decorateGrants,
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
    'partner_identity_relinked',
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

// ---------------------------------------------------------------------------
// Allocation maths
// ---------------------------------------------------------------------------

test('countGrantUsage ignores no-shows and unknown comp types', () => {
  assert.deepEqual(
    countGrantUsage([
      { comp_type: 'free', status: 'pending' },
      { comp_type: 'free', status: 'checked_in' },
      { comp_type: 'free', status: 'no_show' },
      { comp_type: 'discount', status: 'checked_in' },
      { comp_type: 'mystery', status: 'pending' },
    ]),
    { free: 2, discount: 1, total: 3 }
  );
  assert.deepEqual(countGrantUsage(), { free: 0, discount: 0, total: 0 });
});

test('validateGrantSlots requires whole non-negative numbers', () => {
  for (const bad of [
    { total_slots: '', free_slots: '0', discount_slots: '0' },
    { total_slots: '5', free_slots: '-1', discount_slots: '0' },
    { total_slots: '5', free_slots: '1.5', discount_slots: '0' },
    { total_slots: '5', free_slots: 'abc', discount_slots: '0' },
    { total_slots: 5, free_slots: 1 },
  ]) {
    assert.equal(validateGrantSlots(bad).valid, false);
  }
});

test('validateGrantSlots mirrors the DB free + discount <= total constraint', () => {
  const tooMany = validateGrantSlots({ total_slots: 5, free_slots: 4, discount_slots: 2 });
  assert.equal(tooMany.valid, false);
  assert.match(tooMany.error, /more than the total of 5/);

  const ok = validateGrantSlots({ total_slots: '10', free_slots: '6', discount_slots: '4' });
  assert.deepEqual(ok, { valid: true, data: { total_slots: 10, free_slots: 6, discount_slots: 4 } });
});

test('validateGrantSlots refuses to shrink an allocation below what is used', () => {
  const usage = { free: 3, discount: 2, total: 5 };

  const cutFree = validateGrantSlots({ total_slots: 10, free_slots: 2, discount_slots: 2 }, usage);
  assert.equal(cutFree.valid, false);
  assert.match(cutFree.error, /already has 3 free guests/);

  const cutDiscount = validateGrantSlots({ total_slots: 10, free_slots: 3, discount_slots: 1 }, usage);
  assert.equal(cutDiscount.valid, false);
  assert.match(cutDiscount.error, /already has 2 discounted guests/);

  // Shrinking down to exactly the used count is allowed.
  assert.equal(
    validateGrantSlots({ total_slots: 5, free_slots: 3, discount_slots: 2 }, usage).valid,
    true
  );
});

test('buildGrantPayload trims text and drops discount detail when there are no discount slots', () => {
  const withDiscount = buildGrantPayload({
    total_slots: 4,
    free_slots: 2,
    discount_slots: 2,
    discount_detail: '  50% off door  ',
    notes: '  holds the back room  ',
  });
  assert.deepEqual(withDiscount.data, {
    total_slots: 4,
    free_slots: 2,
    discount_slots: 2,
    discount_detail: '50% off door',
    notes: 'holds the back room',
  });

  const noDiscount = buildGrantPayload({
    total_slots: 4,
    free_slots: 4,
    discount_slots: 0,
    discount_detail: '50% off door',
  });
  assert.equal(noDiscount.data.discount_detail, null);
  assert.equal(noDiscount.data.notes, null);

  assert.equal(buildGrantPayload({ total_slots: 1, free_slots: 2, discount_slots: 0 }).valid, false);
});

test('grantRevokeBlockedMessage only blocks when a slot is still occupied', () => {
  assert.equal(grantRevokeBlockedMessage({ free: 0, discount: 0, total: 0 }), null);
  assert.equal(grantRevokeBlockedMessage(null), null);
  assert.match(
    grantRevokeBlockedMessage({ free: 1, discount: 0, total: 1 }),
    /1 guest entry .*Remove or check in guest entries first/
  );
});

test('decorateGrants attaches usage plus partner state and sorts by contact name', () => {
  const decorated = decorateGrants(
    [
      {
        id: 'g2',
        contact_id: 'c2',
        contact: { display_name: 'Zebra Collective' },
        entries: [{ comp_type: 'free', status: 'checked_in' }],
      },
      { id: 'g1', contact_id: 'c1', contact: { display_name: 'apex sound' } },
    ],
    [{ contact_id: 'c2', is_active: true, invited_at: 'i', activated_at: 'a' }]
  );

  assert.deepEqual(decorated.map((g) => g.id), ['g1', 'g2']);
  assert.equal(decorated[0].partner, null);
  assert.deepEqual(decorated[0].usage, { free: 0, discount: 0, total: 0 });
  assert.deepEqual(decorated[0].entries, []);
  assert.deepEqual(decorated[1].partner, {
    is_active: true,
    invited_at: 'i',
    activated_at: 'a',
  });
  assert.deepEqual(decorated[1].usage, { free: 1, discount: 0, total: 1 });
});

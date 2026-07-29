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
  resolveGrantNotification,
  grantSlotsIncreased,
  grantNotificationNotice,
  summarizeGrants,
  summarizeEventGuestlists,
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

// ---------------------------------------------------------------------------
// Grant notification
// ---------------------------------------------------------------------------

const ACTIVE_PARTNER = { is_active: true };
const SLOTS = { free_slots: 2, discount_slots: 1 };

test('resolveGrantNotification only mails an active partner who can spend slots', () => {
  assert.deepEqual(
    resolveGrantNotification({
      contact: { email: '  Promoter@Example.com  ' },
      partner: ACTIVE_PARTNER,
      slots: SLOTS,
    }),
    { send: true, reason: null, email: 'Promoter@Example.com' }
  );
});

test('resolveGrantNotification skips a contact who cannot use the portal yet', () => {
  const contact = { email: 'promoter@example.com' };

  assert.deepEqual(resolveGrantNotification({ contact, partner: null, slots: SLOTS }), {
    send: false,
    reason: 'no_partner',
  });
  assert.deepEqual(
    resolveGrantNotification({ contact, partner: { is_active: false }, slots: SLOTS }),
    { send: false, reason: 'invite_pending' }
  );
  assert.deepEqual(resolveGrantNotification({ contact: {}, partner: ACTIVE_PARTNER, slots: SLOTS }), {
    send: false,
    reason: 'no_email',
  });
  assert.deepEqual(
    resolveGrantNotification({
      contact,
      partner: ACTIVE_PARTNER,
      slots: { total_slots: 5, free_slots: 0, discount_slots: 0 },
    }),
    { send: false, reason: 'no_spendable_slots' }
  );
});

test('grantSlotsIncreased only fires when spendable slots go up', () => {
  const before = { free_slots: 2, discount_slots: 2 };
  assert.equal(grantSlotsIncreased(before, { free_slots: 3, discount_slots: 2 }), true);
  assert.equal(grantSlotsIncreased(before, { free_slots: 2, discount_slots: 3 }), true);
  assert.equal(grantSlotsIncreased(before, { free_slots: 2, discount_slots: 2 }), false);
  assert.equal(grantSlotsIncreased(before, { free_slots: 1, discount_slots: 2 }), false);
});

test('grantNotificationNotice explains the outcome, and stays quiet when there is none', () => {
  assert.match(grantNotificationNotice({ sent: true }), /Emailed the partner/);
  assert.match(grantNotificationNotice({ sent: false, reason: 'no_partner' }), /no partner login/);
  assert.match(grantNotificationNotice({ sent: false, reason: 'send_failed' }), /could not be sent/);
  assert.equal(grantNotificationNotice({ sent: false, reason: 'slots_not_increased' }), null);
  assert.equal(grantNotificationNotice(null), null);
});

// ---------------------------------------------------------------------------
// Cross-event reporting
// ---------------------------------------------------------------------------

test('summarizeGrants totals allocation, usage and door check-ins', () => {
  assert.deepEqual(
    summarizeGrants([
      {
        total_slots: 6,
        free_slots: 4,
        discount_slots: 2,
        entries: [
          { comp_type: 'free', status: 'checked_in' },
          { comp_type: 'free', status: 'pending' },
          // A no-show hands the slot back, but the door did see the name.
          { comp_type: 'discount', status: 'no_show' },
        ],
      },
      { total_slots: 2, free_slots: 2, discount_slots: 0, entries: [] },
    ]),
    {
      partners: 2,
      total_slots: 8,
      free_slots: 6,
      discount_slots: 2,
      used_free: 2,
      used_discount: 0,
      used: 2,
      checked_in: 1,
    }
  );
  assert.equal(summarizeGrants().partners, 0);
});

test('summarizeEventGuestlists groups by event, newest first, and drops orphans', () => {
  const rows = summarizeEventGuestlists([
    {
      event: { id: 'e1', title: 'Older', event_date: '2026-01-10' },
      total_slots: 2,
      free_slots: 2,
      discount_slots: 0,
      entries: [{ comp_type: 'free', status: 'pending' }],
    },
    {
      event: { id: 'e2', title: 'Newer', event_date: '2026-02-10' },
      total_slots: 3,
      free_slots: 1,
      discount_slots: 2,
      entries: [],
    },
    {
      event: { id: 'e1', title: 'Older', event_date: '2026-01-10' },
      total_slots: 1,
      free_slots: 1,
      discount_slots: 0,
      entries: [{ comp_type: 'free', status: 'checked_in' }],
    },
    { event: null, total_slots: 9, free_slots: 9, discount_slots: 0, entries: [] },
  ]);

  assert.deepEqual(rows.map((r) => r.event.id), ['e2', 'e1']);
  assert.equal(rows[1].partners, 2);
  assert.equal(rows[1].free_slots, 3);
  assert.equal(rows[1].used, 2);
  assert.equal(rows[1].checked_in, 1);
});

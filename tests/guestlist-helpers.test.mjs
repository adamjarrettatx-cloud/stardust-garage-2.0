import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMP_TYPE_OPTIONS,
  ENTRY_STATUS_OPTIONS,
  GUESTLIST_AUDIT_ACTIONS,
  compTypeLabel,
  entryStatusLabel,
  auditGuestlist,
  addableCompTypes,
  austinToday,
  canRemoveEntry,
  compTypeUsage,
  entryOccupiesSlot,
  grantUsage,
  normalizeGuestName,
  splitGrantsByDate,
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
// Slot accounting
//
// These cover the JS half of a rule that is enforced twice: here (so the UI
// greys out the right button) and in the BEFORE INSERT trigger in
// 20260731_partner_guestlist_portal.sql (so it is actually true). The two must
// agree, which is what the "no_show" cases below are really pinning down.
// ---------------------------------------------------------------------------

const entry = (comp_type, status = 'pending') => ({ comp_type, status });

test('a no_show frees its slot back up; pending and checked_in do not', () => {
  assert.equal(entryOccupiesSlot({ status: 'pending' }), true);
  assert.equal(entryOccupiesSlot({ status: 'checked_in' }), true);
  assert.equal(entryOccupiesSlot({ status: 'no_show' }), false);
  assert.equal(entryOccupiesSlot(null), false);
});

test('compTypeUsage counts only its own comp type and only occupied slots', () => {
  const entries = [
    entry('free'),
    entry('free', 'checked_in'),
    entry('free', 'no_show'),
    entry('discount'),
  ];

  assert.deepEqual(compTypeUsage(entries, 'free', 5), {
    compType: 'free',
    used: 2,
    total: 5,
    remaining: 3,
    allocated: true,
    full: false,
  });
  assert.equal(compTypeUsage(entries, 'discount', 1).full, true);
});

test('compTypeUsage treats a missing allocation as none, not as unlimited', () => {
  const none = compTypeUsage([], 'discount', 0);
  assert.equal(none.allocated, false);
  assert.equal(none.full, true);
  assert.equal(compTypeUsage([], 'discount', undefined).total, 0);
  assert.equal(compTypeUsage(undefined, 'free', 2).used, 0);
});

test('remaining never goes negative when an allocation is cut below what is used', () => {
  const usage = compTypeUsage([entry('free'), entry('free'), entry('free')], 'free', 1);
  assert.equal(usage.used, 3);
  assert.equal(usage.remaining, 0);
  assert.equal(usage.full, true);
});

test('addableCompTypes offers only types that are allocated and have room', () => {
  const grant = { free_slots: 2, discount_slots: 2 };

  assert.deepEqual(addableCompTypes(grantUsage(grant, [])), ['free', 'discount']);
  assert.deepEqual(
    addableCompTypes(grantUsage(grant, [entry('free'), entry('free')])),
    ['discount']
  );
  assert.deepEqual(
    addableCompTypes(grantUsage({ free_slots: 1, discount_slots: 0 }, [])),
    ['free']
  );
  assert.deepEqual(
    addableCompTypes(grantUsage(grant, [entry('free'), entry('free'), entry('discount'), entry('discount')])),
    []
  );
});

test('a no_show reopens a full allocation', () => {
  const grant = { free_slots: 1, discount_slots: 0 };
  assert.deepEqual(addableCompTypes(grantUsage(grant, [entry('free')])), []);
  assert.deepEqual(addableCompTypes(grantUsage(grant, [entry('free', 'no_show')])), ['free']);
});

test('only a pending entry may be withdrawn by the partner', () => {
  assert.equal(canRemoveEntry({ status: 'pending' }), true);
  assert.equal(canRemoveEntry({ status: 'checked_in' }), false);
  assert.equal(canRemoveEntry({ status: 'no_show' }), false);
  assert.equal(canRemoveEntry(undefined), false);
});

test('normalizeGuestName collapses the whitespace people paste in', () => {
  assert.equal(normalizeGuestName('  Ada   Lovelace \n'), 'Ada Lovelace');
  assert.equal(normalizeGuestName(''), '');
  assert.equal(normalizeGuestName(null), '');
  assert.equal(normalizeGuestName(42), '');
});

// ---------------------------------------------------------------------------
// Grouping grants for display
// ---------------------------------------------------------------------------

test('splitGrantsByDate keeps today upcoming and sorts each side toward now', () => {
  const grants = [
    { id: 'later', event_date: '2026-08-10' },
    { id: 'past', event_date: '2026-07-01' },
    { id: 'today', event_date: '2026-07-29' },
    { id: 'soon', event_date: '2026-07-30' },
    { id: 'older', event_date: '2026-06-01' },
  ];

  const { upcoming, past } = splitGrantsByDate(grants, '2026-07-29');

  // An event happening tonight is the one they most need, so today counts as
  // upcoming rather than dropping into the collapsed past section.
  assert.deepEqual(upcoming.map((g) => g.id), ['today', 'soon', 'later']);
  assert.deepEqual(past.map((g) => g.id), ['past', 'older']);
});

test('splitGrantsByDate shows an undated grant rather than burying it', () => {
  const { upcoming, past } = splitGrantsByDate([{ id: 'tbc', event_date: null }], '2026-07-29');
  assert.deepEqual(upcoming.map((g) => g.id), ['tbc']);
  assert.equal(past.length, 0);
});

test('splitGrantsByDate tolerates no grants at all', () => {
  assert.deepEqual(splitGrantsByDate(undefined, '2026-07-29'), { upcoming: [], past: [] });
});

test('austinToday formats as the YYYY-MM-DD that event_date is compared against', () => {
  // 03:00 UTC on the 30th is still the 29th in Austin, which is exactly the
  // case that would push a night still in progress into "past".
  assert.equal(austinToday(new Date('2026-07-30T03:00:00Z')), '2026-07-29');
  assert.match(austinToday(), /^\d{4}-\d{2}-\d{2}$/);
});

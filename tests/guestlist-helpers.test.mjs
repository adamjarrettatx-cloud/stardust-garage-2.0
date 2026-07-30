import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  COMP_TYPE_OPTIONS,
  ENTRY_STATUS_OPTIONS,
  GUESTLIST_AUDIT_ACTIONS,
  compTypeLabel,
  entryStatusLabel,
  auditGuestlist,
  addableCompTypes,
  austinToday,
  buildGrantPayload,
  canRemoveEntry,
  compTypeUsage,
  countGrantUsage,
  decorateGrants,
  entryOccupiesSlot,
  grantNotificationNotice,
  grantRevokeBlockedMessage,
  grantSlotsIncreased,
  grantUsage,
  normalizeGuestName,
  resolveGrantNotification,
  splitGrantsByDate,
  summarizeEventGuestlists,
  summarizeGrants,
  validateGrantSlots,
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
    'marked_no_show',
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

const MIGRATIONS = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../supabase/migrations'
);

// The trigger holding up the other half of this rule locks the grant row with
// SELECT ... FOR UPDATE, and PostgreSQL applies the UPDATE policies to a locking
// read. Partners hold no UPDATE policy on event_guestlist_grants on purpose, so
// without SECURITY DEFINER that lock matches nothing and every partner add fails
// as GL404 — which is exactly what shipped in Phase 3.
test('the capacity trigger runs as its definer, not as the partner inserting', () => {
  const headers = fs
    .readdirSync(MIGRATIONS)
    .sort()
    .flatMap((file) =>
      fs.readFileSync(path.join(MIGRATIONS, file), 'utf8').split(/create or replace function /i)
    )
    .filter((chunk) => chunk.startsWith('public.event_guestlist_entries_enforce_capacity()'))
    .map((chunk) => chunk.split('$$')[0]);

  // Migrations replay in filename order, so the last definition is the one the
  // database is left holding.
  assert.ok(headers.length > 0, 'no definition of the capacity trigger function found');
  assert.match(headers.at(-1), /security definer/i);
});

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

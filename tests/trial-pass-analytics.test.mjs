import { test } from 'node:test';
import { deepStrictEqual, strictEqual } from 'node:assert';

// The analytics compute layer is a pure function, so we can hand it fixture
// data and assert the shape. This is where we lock down the bucketing and
// rate math so a refactor can't quietly break the dashboard.

import { computeAnalytics, computeByEvent } from '../lib/trial-pass-analytics.js';
import { TRIAL_MEMBER_STATUS_RANK, TRIAL_MEMBER_STATUS } from '../lib/trial-member-profile.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();
const dayAgo = (n) => new Date(now - n * DAY_MS).toISOString();

test('empty inputs produce a valid zero-state', () => {
  const out = computeAnalytics({ passes: [], checkins: [] });
  strictEqual(out.totals.all, 0);
  strictEqual(out.funnel.issued, 0);
  strictEqual(out.rates.endToEnd, 0);
  deepStrictEqual(out.recent, []);
});

test('funnel counts every stage independently', () => {
  const out = computeAnalytics({
    passes: [
      { id: 'a', status: 'active', signup_source: 'trial_pass_qr', issued_at: dayAgo(2), expires_at: dayAgo(-28), applied_at: null, converted_at: null },
      { id: 'b', status: 'active', signup_source: 'trial_pass_qr', issued_at: dayAgo(5), expires_at: dayAgo(-25), applied_at: dayAgo(1), converted_at: null },
      { id: 'c', status: 'active', signup_source: 'front_desk_manual', issued_at: dayAgo(10), expires_at: dayAgo(-20), applied_at: dayAgo(3), converted_at: dayAgo(1) },
    ],
    checkins: [
      { trial_pass_id: 'b', result: 'allowed', reason: null, scanned_at: dayAgo(4) },
      { trial_pass_id: 'c', result: 'allowed', reason: null, scanned_at: dayAgo(8) },
    ],
  });
  strictEqual(out.funnel.issued, 3);
  strictEqual(out.funnel.checkedIn, 2);
  strictEqual(out.funnel.applied, 2);
  strictEqual(out.funnel.converted, 1);
});

test('conversion rates handle zero-denominator without dividing', () => {
  const out = computeAnalytics({
    passes: [{ id: 'a', status: 'active', signup_source: 'trial_pass_qr', issued_at: dayAgo(1), expires_at: dayAgo(-29) }],
    checkins: [],
  });
  strictEqual(out.rates.checkinToApplied, 0);
  strictEqual(out.rates.appliedToConverted, 0);
  strictEqual(out.rates.endToEnd, 0);
});

test('denial reasons are counted and sorted by frequency', () => {
  const out = computeAnalytics({
    passes: [],
    checkins: [
      { trial_pass_id: 'x', result: 'denied', reason: 'expired', scanned_at: dayAgo(1) },
      { trial_pass_id: 'x', result: 'denied', reason: 'expired', scanned_at: dayAgo(2) },
      { trial_pass_id: 'y', result: 'denied', reason: 'not_found', scanned_at: dayAgo(3) },
      { trial_pass_id: 'z', result: 'allowed', reason: null, scanned_at: dayAgo(4) },
    ],
  });
  deepStrictEqual(out.denialReasons, [
    { reason: 'expired', count: 2 },
    { reason: 'not_found', count: 1 },
  ]);
});

test('day-of-first-checkin bucketing catches the boundaries', () => {
  const out = computeAnalytics({
    passes: [
      { id: 'a', status: 'active', signup_source: 'q', issued_at: dayAgo(0), expires_at: dayAgo(-30) }, // same day
      { id: 'b', status: 'active', signup_source: 'q', issued_at: dayAgo(3), expires_at: dayAgo(-27) },  // 1-3
      { id: 'c', status: 'active', signup_source: 'q', issued_at: dayAgo(7), expires_at: dayAgo(-23) },  // 4-7
      { id: 'd', status: 'active', signup_source: 'q', issued_at: dayAgo(14), expires_at: dayAgo(-16) }, // 8-14
      { id: 'e', status: 'active', signup_source: 'q', issued_at: dayAgo(30), expires_at: dayAgo(0) },   // 15-30
    ],
    checkins: [
      { trial_pass_id: 'a', result: 'allowed', reason: null, scanned_at: dayAgo(0) },
      { trial_pass_id: 'b', result: 'allowed', reason: null, scanned_at: dayAgo(1) },
      { trial_pass_id: 'c', result: 'allowed', reason: null, scanned_at: dayAgo(1) },
      { trial_pass_id: 'd', result: 'allowed', reason: null, scanned_at: dayAgo(1) },
      { trial_pass_id: 'e', result: 'allowed', reason: null, scanned_at: dayAgo(1) },
    ],
  });
  const bucketMap = Object.fromEntries(out.dayBuckets.map((b) => [b.label, b.count]));
  strictEqual(bucketMap['Same day'], 1);
  strictEqual(bucketMap['1\u20133 days'], 1);
  strictEqual(bucketMap['4\u20137 days'], 1);
  strictEqual(bucketMap['8\u201314 days'], 1);
  strictEqual(bucketMap['15\u201330 days'], 1);
});

test('recent list uses effective expiry and preserves order', () => {
  // Both passes are activated (activated_at set) so daysLeft is driven by
  // extended_until · expires_at, not the 60-day signup window.
  const out = computeAnalytics({
    passes: [
      { id: 'newer', full_name: 'Newer Guest', email: 'n@example.com', status: 'active', signup_source: 'trial_pass_qr', issued_at: dayAgo(1), activated_at: dayAgo(1), expires_at: new Date(now + 20 * DAY_MS).toISOString(), extended_until: null, applied_at: null, converted_at: null },
      { id: 'older', full_name: 'Older Guest', email: 'o@example.com', status: 'active', signup_source: 'trial_pass_qr', issued_at: dayAgo(5), activated_at: dayAgo(5), expires_at: new Date(now + 10 * DAY_MS).toISOString(), extended_until: new Date(now + 15 * DAY_MS).toISOString(), applied_at: null, converted_at: null },
    ],
    checkins: [],
  });
  strictEqual(out.recent[0].id, 'newer');
  strictEqual(out.recent[1].id, 'older');
  // extended_until should win over expires_at for daysLeft.
  strictEqual(out.recent[1].daysLeft, 15);
  strictEqual(out.recent[0].activationPhase, 'activated');
});

test('activation splits: unactivated pass has its own KPI and phase', () => {
  const out = computeAnalytics({
    passes: [
      // Activated: 30-day clock ticking.
      { id: 'a', full_name: 'A', email: 'a@x.com', status: 'active', signup_source: 'trial_pass_qr', issued_at: dayAgo(2), activated_at: dayAgo(2), expires_at: new Date(now + 28 * DAY_MS).toISOString(), extended_until: null, applied_at: null, converted_at: null, signup_expires_at: new Date(now + 58 * DAY_MS).toISOString() },
      // Unactivated: never checked in. daysLeft counts down to 60-day cutoff.
      { id: 'b', full_name: 'B', email: 'b@x.com', status: 'active', signup_source: 'trial_pass_qr', issued_at: dayAgo(3), activated_at: null, expires_at: null, extended_until: null, applied_at: null, converted_at: null, signup_expires_at: new Date(now + 57 * DAY_MS).toISOString() },
    ],
    checkins: [],
  });
  strictEqual(out.totals.active, 2);
  strictEqual(out.totals.activeActivated, 1);
  strictEqual(out.totals.activeUnactivated, 1);
  const byId = Object.fromEntries(out.recent.map((r) => [r.id, r]));
  strictEqual(byId.a.activationPhase, 'activated');
  strictEqual(byId.b.activationPhase, 'unactivated');
  strictEqual(byId.b.daysLeft, 57);
});

test('multiple check-ins for same pass count once toward funnel but track individually', () => {
  const out = computeAnalytics({
    passes: [{ id: 'a', status: 'active', signup_source: 'q', issued_at: dayAgo(10), expires_at: dayAgo(-20) }],
    checkins: [
      { trial_pass_id: 'a', result: 'allowed', reason: null, scanned_at: dayAgo(1) },
      { trial_pass_id: 'a', result: 'allowed', reason: null, scanned_at: dayAgo(2) },
      { trial_pass_id: 'a', result: 'allowed', reason: null, scanned_at: dayAgo(3) },
    ],
  });
  strictEqual(out.funnel.checkedIn, 1); // one pass, not three
  strictEqual(out.recent[0].checkinCount, 3); // but visits counted correctly
});

// Profile linking status rank guardrails.

test('trial_member rank sits above trial_expired and guest', () => {
  strictEqual(
    TRIAL_MEMBER_STATUS_RANK.trial_member > TRIAL_MEMBER_STATUS_RANK.guest,
    true,
    'trial_member outranks guest',
  );
  strictEqual(
    TRIAL_MEMBER_STATUS_RANK.trial_member > TRIAL_MEMBER_STATUS_RANK.trial_expired,
    true,
    'trial_member outranks trial_expired',
  );
});

test('trial_member never demotes an applicant or member', () => {
  strictEqual(
    TRIAL_MEMBER_STATUS_RANK.trial_member < TRIAL_MEMBER_STATUS_RANK.applicant,
    true,
    'trial_member ranks below applicant',
  );
  strictEqual(
    TRIAL_MEMBER_STATUS_RANK.trial_member < TRIAL_MEMBER_STATUS_RANK.member,
    true,
    'trial_member ranks below member',
  );
});

test('TRIAL_MEMBER_STATUS constant is the string used across the schema', () => {
  strictEqual(TRIAL_MEMBER_STATUS, 'trial_member');
});

// Real DB schema shape: trial_pass_checkins has (checked_in_at, notes), not
// (scanned_at, reason). Prod page went blank the first deploy because the
// select() specified nonexistent columns. This test locks in that the
// pure compute layer accepts the actual production shape.
test('accepts DB-native checkin shape (checked_in_at + notes)', () => {
  const out = computeAnalytics({
    passes: [
      { id: 'a', status: 'active', signup_source: 'q', issued_at: dayAgo(5), expires_at: dayAgo(-25) },
    ],
    checkins: [
      { trial_pass_id: 'a', result: 'denied', notes: 'pass expired', checked_in_at: dayAgo(1) },
      { trial_pass_id: 'a', result: 'allowed', notes: null, checked_in_at: dayAgo(2) },
    ],
  });
  strictEqual(out.funnel.checkedIn, 1);
  strictEqual(out.denialReasons[0].reason, 'pass expired');
});

// -----------------------------------------------------------------------------
// By-event grouping
// -----------------------------------------------------------------------------

test('computeByEvent groups check-ins by event and orders newest first', () => {
  const passes = [
    { id: 'p1', full_name: 'Ada Lovelace', email: 'ada@example.com', phone: '+15125550101', signup_source: 'trial_pass_qr', phone_verified_at: dayAgo(4), applied_at: null, converted_at: null },
    { id: 'p2', full_name: 'Grace Hopper', email: 'grace@example.com', phone: '+15125550102', signup_source: 'front_desk_manual', phone_verified_at: null, applied_at: dayAgo(1), converted_at: null },
    { id: 'p3', full_name: 'Alan Turing', email: 'alan@example.com', phone: null, signup_source: 'trial_pass_qr', phone_verified_at: dayAgo(9), applied_at: null, converted_at: dayAgo(1) },
  ];
  const events = [
    { id: 'ev-old', title: 'Warehouse Warmup', event_date: '2026-09-13', event_time: '21:00:00' },
    { id: 'ev-new', title: 'Stardust Saturday', event_date: '2026-09-20', event_time: '22:00:00' },
  ];
  const checkins = [
    { trial_pass_id: 'p1', event_id: 'ev-new', result: 'allowed', reject_reason: null, notes: null, checked_in_at: dayAgo(1) },
    { trial_pass_id: 'p2', event_id: 'ev-new', result: 'allowed', reject_reason: null, notes: null, checked_in_at: dayAgo(1) },
    { trial_pass_id: 'p2', event_id: 'ev-new', result: 'denied_duplicate', reject_reason: null, notes: null, checked_in_at: dayAgo(1) },
    { trial_pass_id: 'p3', event_id: 'ev-old', result: 'allowed', reject_reason: null, notes: null, checked_in_at: dayAgo(8) },
    { trial_pass_id: 'p1', event_id: 'ev-old', result: 'rejected', reject_reason: 'photo_mismatch', notes: null, checked_in_at: dayAgo(8) },
  ];

  const out = computeByEvent({ passes, checkins, events });

  strictEqual(out.length, 2);
  strictEqual(out[0].eventId, 'ev-new'); // newest first
  strictEqual(out[0].title, 'Stardust Saturday');
  strictEqual(out[0].allowedCount, 2);   // p1 + p2 unique passes
  strictEqual(out[0].rejectedCount, 0);
  strictEqual(out[0].deniedCount, 1);    // p2 duplicate
  strictEqual(out[0].attendees.length, 2);

  strictEqual(out[1].eventId, 'ev-old');
  strictEqual(out[1].allowedCount, 1);
  strictEqual(out[1].rejectedCount, 1);
  strictEqual(out[1].attendees.length, 1);
  strictEqual(out[1].attendees[0].fullName, 'Alan Turing');
  strictEqual(out[1].attendees[0].convertedAt !== null, true);
});

test('computeByEvent labels missing events as "Unknown event" without dropping rows', () => {
  const passes = [
    { id: 'p1', full_name: 'Test User', email: 't@example.com', phone: null, signup_source: 'trial_pass_qr' },
  ];
  const checkins = [
    { trial_pass_id: 'p1', event_id: 'ev-missing', result: 'allowed', reject_reason: null, notes: null, checked_in_at: dayAgo(1) },
  ];
  const out = computeByEvent({ passes, checkins, events: [] });
  strictEqual(out.length, 1);
  strictEqual(out[0].title, 'Unknown event');
  strictEqual(out[0].attendees.length, 1);
});

test('computeByEvent buckets check-ins with no event_id under a front-desk group', () => {
  const passes = [
    { id: 'p1', full_name: 'Walk In', email: 'w@example.com', phone: null, signup_source: 'front_desk_manual' },
  ];
  const checkins = [
    { trial_pass_id: 'p1', event_id: null, result: 'allowed', reject_reason: null, notes: null, checked_in_at: dayAgo(1) },
  ];
  const out = computeByEvent({ passes, checkins, events: [] });
  strictEqual(out.length, 1);
  strictEqual(out[0].eventId, null);
  strictEqual(out[0].title, 'No event (front desk)');
  strictEqual(out[0].allowedCount, 1);
});

test('computeByEvent dedupes attendees by pass id even if allowed twice', () => {
  const passes = [
    { id: 'p1', full_name: 'Repeat Scan', email: 'r@example.com', phone: null, signup_source: 'trial_pass_qr' },
  ];
  // Older backfilled data could plausibly contain two 'allowed' rows for the
  // same pass at the same event even though the current unique index prevents
  // it. The CSV should still emit exactly one row.
  const checkins = [
    { trial_pass_id: 'p1', event_id: 'ev1', result: 'allowed', reject_reason: null, notes: null, checked_in_at: dayAgo(1) },
    { trial_pass_id: 'p1', event_id: 'ev1', result: 'allowed', reject_reason: null, notes: null, checked_in_at: dayAgo(2) },
  ];
  const out = computeByEvent({
    passes,
    checkins,
    events: [{ id: 'ev1', title: 'Doubled', event_date: '2026-09-20', event_time: null }],
  });
  strictEqual(out[0].attendees.length, 1);
  // The retained row should be the most recent scan.
  strictEqual(out[0].attendees[0].scannedAt, checkins[0].checked_in_at);
});

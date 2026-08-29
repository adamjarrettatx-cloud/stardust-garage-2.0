import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOOR_RESULTS,
  MAX_REMINDERS,
  MAX_UNACTIVATED_REMINDERS,
  REMINDER_INTERVAL_DAYS,
  TRIAL_EXTENSION_DAYS,
  TRIAL_SIGNUP_WINDOW_DAYS,
  TRIAL_WINDOW_DAYS,
  UNACTIVATED_REMINDER_DAYS,
  addDays,
  buildPassUrl,
  canonicalizeEmail,
  daysRemaining,
  daysSinceActivated,
  daysSinceIssued,
  effectiveExpiry,
  evaluateDoorScan,
  eventWeekday,
  formatPassDate,
  generatePassToken,
  hashPassToken,
  isActivated,
  isEventTrialEligible,
  isPassLive,
  isWellFormedPassToken,
  needsExpiryFlip,
  normalizePhone,
  passStatusLabel,
  passWindowState,
  reminderDueFor,
  validateTrialPassIntake,
} from '../lib/trial-pass.js';
import { encodeQrMatrix } from '../lib/qr-code.js';

// Every rule the Trial SDG Pass runs on lives in lib/trial-pass.js precisely so
// it can be tested here without a database, a browser, or a guest standing at
// the door while we find out. The cases below are the ones that actually bite:
// boundary days, expired-but-not-yet-flipped passes, a cron that skipped a run,
// and a QR payload that has to physically fit in the encoder we ship.

const ISSUED = '2026-08-01T20:00:00.000Z';
const at = (days, hours = 0) => new Date(Date.parse(ISSUED) + days * 86400000 + hours * 3600000);

// Default fixture is an *activated* pass — the door has already seen this
// guest once, so activated_at is set to the issue date and expires_at is
// 30 days after that. Almost every legacy test in this file was written
// against that shape (30-day countdown, day-24 last nudge, etc), so keeping
// the default here means those tests keep meaning what they meant.
//
// For unactivated-pass behavior use makeUnactivatedPass() below.
function makePass(overrides = {}) {
  return {
    status: 'active',
    issued_at: ISSUED,
    activated_at: ISSUED,
    expires_at: addDays(ISSUED, TRIAL_WINDOW_DAYS).toISOString(),
    signup_expires_at: addDays(ISSUED, TRIAL_SIGNUP_WINDOW_DAYS).toISOString(),
    extended_until: null,
    applied_at: null,
    converted_at: null,
    reminders_sent: 0,
    full_name: 'Jane Q Doe',
    ...overrides,
  };
}

// A signed-up pass that has never seen the door.
//   activated_at = null
//   expires_at   = null (populated at first check-in)
//   signup_expires_at = issued + 60 days
function makeUnactivatedPass(overrides = {}) {
  return {
    status: 'active',
    issued_at: ISSUED,
    activated_at: null,
    expires_at: null,
    signup_expires_at: addDays(ISSUED, TRIAL_SIGNUP_WINDOW_DAYS).toISOString(),
    extended_until: null,
    applied_at: null,
    converted_at: null,
    reminders_sent: 0,
    full_name: 'Jane Q Doe',
    ...overrides,
  };
}

// --- The clock --------------------------------------------------------------

test('a fresh pass is live for the full window and not a day longer', () => {
  const pass = makePass();
  assert.equal(isPassLive(pass, at(0)), true);
  assert.equal(isPassLive(pass, at(29, 23)), true);
  // Exactly at expiry is closed: the comparison is strict, so a pass never
  // outlives its own printed date.
  assert.equal(isPassLive(pass, at(TRIAL_WINDOW_DAYS)), false);
  assert.equal(isPassLive(pass, at(31)), false);
});

test('daysRemaining floors and never goes negative', () => {
  const pass = makePass();
  assert.equal(daysRemaining(pass, at(0)), 30);
  assert.equal(daysRemaining(pass, at(0, 23)), 29, 'a partial day is not a whole day');
  assert.equal(daysRemaining(pass, at(29, 12)), 0, 'the last day reads as "today"');
  assert.equal(daysRemaining(pass, at(45)), 0, 'long expired still reads 0, never -15');
});

test('daysSinceIssued is the axis reminders are measured on', () => {
  const pass = makePass();
  assert.equal(daysSinceIssued(pass, at(0)), 0);
  assert.equal(daysSinceIssued(pass, at(5, 23)), 5);
  assert.equal(daysSinceIssued(pass, at(6)), 6);
});

test('an extension can only ever help the guest', () => {
  const base = makePass();
  const extended = makePass({
    extended_until: addDays(base.expires_at, TRIAL_EXTENSION_DAYS).toISOString(),
  });
  assert.equal(isPassLive(extended, at(33)), true, 'the extra week works');
  assert.equal(isPassLive(extended, at(38)), false, 'and then it does not');

  // A backdated extended_until must not shorten a pass — effectiveExpiry takes
  // the later of the two dates, so a mis-keyed extension cannot lock a guest
  // out of days they already had.
  const badlyExtended = makePass({ extended_until: addDays(ISSUED, 2).toISOString() });
  assert.equal(
    effectiveExpiry(badlyExtended).toISOString(),
    base.expires_at,
    'the original 30-day deadline still stands',
  );
  assert.equal(isPassLive(badlyExtended, at(20)), true);
});

test('a status of expired beats the calendar', () => {
  // Staff or the cron marked it dead. Even inside the window, dead is dead —
  // this is how a revoked pass stays revoked.
  const revoked = makePass({ status: 'expired' });
  assert.equal(isPassLive(revoked, at(3)), false);
});

test('applying does not cost the guest their remaining days', () => {
  const applied = makePass({ status: 'applied', applied_at: at(3).toISOString() });
  assert.equal(isPassLive(applied, at(10)), true, 'doing what we asked is not a penalty');
  const converted = makePass({ status: 'converted', converted_at: at(4).toISOString() });
  assert.equal(isPassLive(converted, at(10)), true);
});

// --- Tokens -----------------------------------------------------------------

test('tokens are unique, url-safe, and only stored hashed', () => {
  const a = generatePassToken();
  const b = generatePassToken();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'base64url only — safe in a path segment');
  assert.equal(isWellFormedPassToken(a), true);

  const hash = hashPassToken(a);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, hashPassToken(a), 'deterministic, so lookups work');
  assert.notEqual(hash, hashPassToken(b));
  assert.equal(hash.includes(a), false, 'the raw token is not recoverable from the row');
});

test('malformed tokens are rejected before they can become a query', () => {
  for (const bad of ['', null, undefined, 'short', 'has spaces in it', 'has/slash', 'a'.repeat(65), 42]) {
    assert.equal(isWellFormedPassToken(bad), false, `rejected: ${String(bad)}`);
  }
  assert.equal(hashPassToken(''), null);
  assert.equal(hashPassToken(null), null);
});

test('the pass URL fits the QR encoder we actually ship', () => {
  // lib/qr-code.js tops out at version 6 byte mode and returns null above it.
  // If the token or the domain ever grows past that ceiling, every printed
  // flier stops producing a scannable code — so assert it here rather than
  // discovering it on a Friday night.
  const url = buildPassUrl('https://sdgatx.com', generatePassToken());
  assert.match(url, /^https:\/\/sdgatx\.com\/pass\/[A-Za-z0-9_-]+$/);
  assert.ok(url.length < 100, `pass URL is ${url.length} chars`);
  const matrix = encodeQrMatrix(url);
  assert.ok(Array.isArray(matrix) && matrix.length > 0, 'the URL encodes to a real QR matrix');
});

test('buildPassUrl tolerates a trailing slash on the site URL', () => {
  assert.equal(buildPassUrl('https://sdgatx.com/', 'abc'), 'https://sdgatx.com/pass/abc');
  assert.equal(buildPassUrl('https://sdgatx.com', null), null);
});

// --- Intake validation ------------------------------------------------------

test('the three-question form accepts a normal guest and normalizes them', () => {
  const result = validateTrialPassIntake({
    fullName: '  Jane   Q   Doe ',
    phone: '(512) 555-0134',
    email: '  Jane.Doe@Example.COM ',
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    full_name: 'Jane Q Doe',
    phone: '+15125550134',
    email: 'jane.doe@example.com',
    email_canonical: 'jane.doe@example.com',
  });
});

// --- Email canonicalization -------------------------------------------------
//
// email_canonical is the actual dedupe key. If this drifts out of lockstep
// with the generated column SQL in 20260825_trial_pass_identity_anchoring.sql,
// the unique index stops catching what the JS thinks it caught. These are the
// abuse cases we know about: Gmail dot-trick, plus-tag, googlemail alias.

test('canonicalizeEmail collapses the Gmail dot-trick', () => {
  assert.equal(canonicalizeEmail('jane.doe@gmail.com'), 'janedoe@gmail.com');
  assert.equal(canonicalizeEmail('j.a.n.e.d.o.e@gmail.com'), 'janedoe@gmail.com');
  assert.equal(canonicalizeEmail('JaneDoe@GMail.com'), 'janedoe@gmail.com');
});

test('canonicalizeEmail strips +tags from any provider', () => {
  assert.equal(canonicalizeEmail('jane+trial@gmail.com'), 'jane@gmail.com');
  assert.equal(canonicalizeEmail('jane.doe+trial+again@gmail.com'), 'janedoe@gmail.com');
  assert.equal(canonicalizeEmail('jane+123@example.com'), 'jane@example.com');
  assert.equal(canonicalizeEmail('jane+foo@yahoo.com'), 'jane@yahoo.com');
});

test('canonicalizeEmail treats googlemail.com as gmail.com', () => {
  assert.equal(canonicalizeEmail('jane.doe@googlemail.com'), 'janedoe@gmail.com');
  assert.equal(canonicalizeEmail('jane+trial@googlemail.com'), 'jane@gmail.com');
});

test('canonicalizeEmail leaves non-Gmail providers otherwise alone', () => {
  // Dots in a non-Gmail local part are a real difference — jane.doe@icloud.com
  // and janedoe@icloud.com are two different inboxes.
  assert.equal(canonicalizeEmail('jane.doe@icloud.com'), 'jane.doe@icloud.com');
  assert.equal(canonicalizeEmail('Jane.Doe@Icloud.COM'), 'jane.doe@icloud.com');
  assert.equal(canonicalizeEmail('jane@fastmail.com'), 'jane@fastmail.com');
});

test('canonicalizeEmail returns empty for empty and does not crash on junk', () => {
  assert.equal(canonicalizeEmail(''), '');
  assert.equal(canonicalizeEmail(null), '');
  assert.equal(canonicalizeEmail(undefined), '');
  // No @ — return the trimmed lowercase input rather than throwing.
  assert.equal(canonicalizeEmail('not-an-email'), 'not-an-email');
});

test('each missing or malformed field names itself', () => {
  assert.equal(validateTrialPassIntake({ fullName: 'A', phone: '5125550134', email: 'a@b.co' }).field, 'fullName');
  assert.equal(validateTrialPassIntake({ fullName: 'Jane Doe', phone: '555', email: 'a@b.co' }).field, 'phone');
  assert.equal(validateTrialPassIntake({ fullName: 'Jane Doe', phone: '5125550134', email: 'nope' }).field, 'email');
  assert.equal(validateTrialPassIntake(null).valid, false, 'a junk body is a 400, not a crash');
});

test('a mononymous guest is not locked out of a pass', () => {
  // Deliberate: "full legal name" is what we ask for, but one long-enough word
  // is accepted rather than turning the form into an argument.
  assert.equal(validateTrialPassIntake({ fullName: 'Prince', phone: '5125550134', email: 'a@b.co' }).valid, true);
});

test('phone normalization is conservative about numbers it cannot place', () => {
  assert.equal(normalizePhone('512-555-0134'), '+15125550134');
  assert.equal(normalizePhone('1 (512) 555-0134'), '+15125550134');
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone(null), '');
});

// --- Event eligibility ------------------------------------------------------

test('event weekday comes from the event date, never the server clock', () => {
  assert.equal(eventWeekday('2026-08-21'), 5, 'Friday');
  assert.equal(eventWeekday('2026-08-22'), 6, 'Saturday');
  assert.equal(eventWeekday('2026-08-23'), 0, 'Sunday');
  assert.equal(eventWeekday('2026-08-19'), 3, 'Wednesday');
  assert.equal(eventWeekday('not-a-date'), null);
  assert.equal(eventWeekday(null), null);
});

test('the trial covers Friday through Sunday music events only', () => {
  assert.equal(isEventTrialEligible({ event_date: '2026-08-21', category: 'music' }), true);
  assert.equal(isEventTrialEligible({ event_date: '2026-08-23', category: 'Live Music' }), true);
  assert.equal(
    isEventTrialEligible({ event_date: '2026-08-19', category: 'music' }),
    false,
    'a Wednesday music night is not covered',
  );
  assert.equal(
    isEventTrialEligible({ event_date: '2026-08-22', category: 'private_event' }),
    false,
    'a Saturday private buyout is not covered',
  );
  assert.equal(isEventTrialEligible({ event_date: '2026-08-22', category: null }), false);
  assert.equal(isEventTrialEligible(null), false);
});

// --- The door decision ------------------------------------------------------

const MUSIC_FRIDAY = { id: 'e1', event_date: '2026-08-21', category: 'music', title: 'Friday Night' };

test('a live pass on a covered night is allowed', () => {
  const decision = evaluateDoorScan({ pass: makePass(), event: MUSIC_FRIDAY, now: at(10) });
  assert.equal(decision.allowed, true);
  assert.equal(decision.result, DOOR_RESULTS.allowed);
  assert.equal(decision.daysRemaining, 20);
});

test('expiry is checked before anything else and tells staff what to offer', () => {
  const decision = evaluateDoorScan({ pass: makePass(), event: MUSIC_FRIDAY, now: at(40) });
  assert.equal(decision.allowed, false);
  assert.equal(decision.result, DOOR_RESULTS.denied_expired);
  assert.match(decision.staffAction, /\$40/, 'the price is on the screen, not in a manual');
  assert.match(decision.staffAction, /7-day/);
});

test('an expired pass denies even on a perfectly covered night', () => {
  // The ordering matters: a guest whose pass ran out should hear "expired,
  // here is the fix", not "wrong night", which would be untrue and unfixable.
  const decision = evaluateDoorScan({ pass: makePass(), event: MUSIC_FRIDAY, now: at(31) });
  assert.equal(decision.result, DOOR_RESULTS.denied_expired);
});

test('a live pass on the wrong night denies with the reason', () => {
  const wednesday = { id: 'e2', event_date: '2026-08-19', category: 'music' };
  const decision = evaluateDoorScan({ pass: makePass(), event: wednesday, now: at(5) });
  assert.equal(decision.allowed, false);
  assert.equal(decision.result, DOOR_RESULTS.denied_ineligible_event);
  assert.match(decision.staffAction, /Friday-Sunday/);
});

test('no event context means the pass is judged on its dates alone', () => {
  // The door can scan before an event row is selected. That must not deny a
  // valid pass — eligibility is only enforced once we know the night.
  const decision = evaluateDoorScan({ pass: makePass(), event: null, now: at(5) });
  assert.equal(decision.allowed, true);
});

test('a pass already scanned tonight cannot walk in twice', () => {
  const decision = evaluateDoorScan({
    pass: makePass(),
    event: MUSIC_FRIDAY,
    alreadyCheckedIn: true,
    now: at(5),
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.result, DOOR_RESULTS.denied_duplicate);
});

test('an unknown pass is never accidentally allowed', () => {
  const decision = evaluateDoorScan({ pass: null, event: MUSIC_FRIDAY, now: at(1) });
  assert.equal(decision.allowed, false);
  assert.equal(decision.result, null);
});

test('an extended pass gets in during its extra week', () => {
  const pass = makePass({
    status: 'extended',
    extended_until: addDays(addDays(ISSUED, TRIAL_WINDOW_DAYS), TRIAL_EXTENSION_DAYS).toISOString(),
  });
  const sunday = { id: 'e3', event_date: '2026-09-06', category: 'music' };
  assert.equal(evaluateDoorScan({ pass, event: sunday, now: at(34) }).allowed, true);
});

// --- Reminder schedule ------------------------------------------------------

test('nudges land on days 6, 12, 18 and 24 and then stop', () => {
  let sent = 0;
  const seen = [];
  for (let day = 0; day <= TRIAL_WINDOW_DAYS; day++) {
    const due = reminderDueFor(makePass({ reminders_sent: sent }), at(day));
    if (due.due) {
      seen.push(day);
      sent = due.sequence;
    }
  }
  assert.deepEqual(seen, [6, 12, 18, 24]);
  assert.equal(sent, MAX_REMINDERS);
  assert.equal(REMINDER_INTERVAL_DAYS * MAX_REMINDERS, 24, 'the last nudge leaves 6 days to act');
});

test('a cron outage produces one catch-up nudge, not a burst of four', () => {
  // The whole reason the schedule is derived from (elapsed, already sent)
  // rather than "days since last email": if the job is down for a fortnight,
  // the guest must not wake up to four emails.
  const due = reminderDueFor(makePass({ reminders_sent: 0 }), at(25));
  assert.equal(due.due, true);
  assert.equal(due.sequence, 1, 'exactly one, and it is the first');
  assert.equal(due.daysLeft, 5);
});

test('the same day twice is not two emails', () => {
  const first = reminderDueFor(makePass({ reminders_sent: 0 }), at(6));
  assert.equal(first.sequence, 1);
  const second = reminderDueFor(makePass({ reminders_sent: 1 }), at(6));
  assert.equal(second.due, false, 'the recorded send suppresses the repeat');
});

test('nudges stop the moment a guest applies or converts', () => {
  assert.equal(reminderDueFor(makePass({ applied_at: at(2).toISOString() }), at(12)).due, false);
  assert.equal(reminderDueFor(makePass({ status: 'applied' }), at(12)).due, false);
  assert.equal(reminderDueFor(makePass({ converted_at: at(2).toISOString() }), at(12)).due, false);
  assert.equal(reminderDueFor(makePass({ status: 'converted' }), at(12)).due, false);
});

test('an expired or capped-out pass is never nudged', () => {
  assert.equal(reminderDueFor(makePass(), at(35)).due, false, 'no chasing a dead pass');
  assert.equal(reminderDueFor(makePass({ reminders_sent: MAX_REMINDERS }), at(29)).due, false);
  assert.equal(reminderDueFor(null, at(6)).due, false);
});

test('needsExpiryFlip only touches passes the cron owns', () => {
  assert.equal(needsExpiryFlip(makePass(), at(31)), true);
  assert.equal(needsExpiryFlip(makePass(), at(20)), false, 'still live, leave it alone');
  assert.equal(
    needsExpiryFlip(makePass({ status: 'expired' }), at(31)),
    false,
    'already flipped — not flipped again every night',
  );
  assert.equal(
    needsExpiryFlip(makePass({ status: 'converted' }), at(31)),
    false,
    'a member is never walked backwards into expired',
  );
  assert.equal(needsExpiryFlip(makePass({ status: 'applied' }), at(31)), false);
});

// --- Display ----------------------------------------------------------------

test('dates are shown in Austin time, not the server timezone', () => {
  // 04:30 UTC is still the previous evening in Chicago. A pass issued late on a
  // Friday must not tell the guest holding it that it is Saturday.
  assert.equal(formatPassDate('2026-08-20T04:30:00.000Z'), 'August 19, 2026');
  assert.equal(formatPassDate('2026-08-20T18:00:00.000Z'), 'August 20, 2026');
  assert.equal(formatPassDate(null), '');
  assert.equal(formatPassDate('nonsense'), '');
});

test('status labels say what the guest needs to hear', () => {
  assert.equal(passStatusLabel(makePass(), at(5)), 'Active');
  assert.equal(passStatusLabel(makePass(), at(35)), 'Expired');
  assert.equal(
    passStatusLabel(makePass({ extended_until: addDays(ISSUED, 37).toISOString() }), at(33)),
    'Extended',
  );
  assert.equal(passStatusLabel(makePass({ status: 'applied' }), at(5)), 'Application submitted');
  assert.equal(passStatusLabel(makePass({ status: 'converted' }), at(5)), 'Member');
  assert.equal(passStatusLabel(null), 'Not found');
  assert.equal(
    passStatusLabel(makeUnactivatedPass(), at(5)),
    'Ready to use',
    'the pill on the unactivated pass reads Ready to use, not Active',
  );
});

// --- Activation-on-first-visit ---------------------------------------------
//
// The 30-day membership window starts on first door check-in, not at signup.
// These tests pin down the pre-activation state — the 60-day outer window,
// the pass-page copy branch, the reminder ladder split — so a regression on
// this feature is caught before it ships to the door.

test('isActivated distinguishes signed-up from checked-in', () => {
  assert.equal(isActivated(makePass()), true);
  assert.equal(isActivated(makeUnactivatedPass()), false);
  assert.equal(isActivated(null), false);
});

test('unactivated passes use the 60-day signup window as their expiry', () => {
  const pass = makeUnactivatedPass();
  const expiry = effectiveExpiry(pass);
  assert.equal(
    expiry.toISOString(),
    addDays(ISSUED, TRIAL_SIGNUP_WINDOW_DAYS).toISOString(),
    'the outer signup_expires_at drives expiry when there is no activation',
  );
  assert.equal(isPassLive(pass, at(30)), true, 'still alive well after the notional 30-day mark');
  assert.equal(isPassLive(pass, at(59, 23)), true);
  assert.equal(isPassLive(pass, at(TRIAL_SIGNUP_WINDOW_DAYS)), false, 'dies at the 60-day line');
});

test('passWindowState returns the right phase for the pass-page copy', () => {
  const unactivated = passWindowState(makeUnactivatedPass(), at(10));
  assert.equal(unactivated.phase, 'unactivated');
  assert.equal(unactivated.daysToSignupExpiry, 50);

  const activated = passWindowState(makePass(), at(10));
  assert.equal(activated.phase, 'activated');
  assert.equal(activated.daysToExpiry, 20);

  const expiredUnactivated = passWindowState(makeUnactivatedPass(), at(TRIAL_SIGNUP_WINDOW_DAYS));
  assert.equal(expiredUnactivated.phase, 'expired');

  const expiredActivated = passWindowState(makePass(), at(TRIAL_WINDOW_DAYS));
  assert.equal(expiredActivated.phase, 'expired');
});

test('daysSinceActivated is 0 for a pass that never activated', () => {
  assert.equal(daysSinceActivated(makeUnactivatedPass(), at(20)), 0);
  assert.equal(daysSinceActivated(makePass(), at(6)), 6);
});

test('unactivated reminders land on days 14, 30 and 45 with a different CTA', () => {
  let sent = 0;
  const seen = [];
  for (let day = 0; day <= TRIAL_SIGNUP_WINDOW_DAYS; day++) {
    const due = reminderDueFor(makeUnactivatedPass({ reminders_sent: sent }), at(day));
    if (due.due) {
      seen.push({ day, kind: due.kind });
      sent = due.sequence;
    }
  }
  assert.deepEqual(
    seen.map((s) => s.day),
    UNACTIVATED_REMINDER_DAYS,
    'three nudges, at 14 / 30 / 45',
  );
  assert.ok(
    seen.every((s) => s.kind === 'activation_nudge'),
    'unactivated passes are asked to come out, not to apply',
  );
  assert.equal(sent, MAX_UNACTIVATED_REMINDERS);
});

test('activated reminders keep their old cadence and use the application CTA', () => {
  const due = reminderDueFor(makePass({ reminders_sent: 0 }), at(6));
  assert.equal(due.due, true);
  assert.equal(due.kind, 'application_nudge');
});

test('an unactivated pass past its 60-day window needs the expiry flip', () => {
  assert.equal(
    needsExpiryFlip(makeUnactivatedPass(), at(TRIAL_SIGNUP_WINDOW_DAYS + 1)),
    true,
    'the cron catches passes that timed out without ever being used',
  );
  assert.equal(needsExpiryFlip(makeUnactivatedPass(), at(30)), false, 'still inside the outer window');
});

test('door decision on an expired unactivated pass names the real reason', () => {
  const decision = evaluateDoorScan({
    pass: makeUnactivatedPass(),
    event: MUSIC_FRIDAY,
    now: at(TRIAL_SIGNUP_WINDOW_DAYS + 1),
  });
  assert.equal(decision.allowed, false);
  assert.equal(decision.result, DOOR_RESULTS.denied_expired);
  assert.match(decision.reason, /never activated/i, 'staff should not be told to sell an extension');
});

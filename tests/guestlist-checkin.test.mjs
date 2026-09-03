import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOOR_OPERATIONS,
  isDoorOperation,
  normalizeGuestName,
  guestNamesMatch,
  escapeLikePattern,
  maskPhone,
  maskEmail,
  maskGuestProfile,
  matchModeFor,
  validateGuestIntake,
  filterRoster,
  summarizeRoster,
  pickDefaultEventId,
  rosterWindowStart,
} from '../lib/guestlist-checkin.js';
import { GUESTLIST_AUDIT_ACTIONS, ENTRY_STATUS_OPTIONS } from '../lib/guestlist-helpers.js';

// A payload shaped like what the canvas produces: the real PNG magic number
// (which parseSignatureDataUrl checks for) padded out past the minimum size.
const SIGNATURE = `data:image/png;base64,iVBORw0KGgo${'A'.repeat(333)}`;

test('door operations only target statuses the entries CHECK constraint allows', () => {
  const allowed = ENTRY_STATUS_OPTIONS.map((o) => o.value);
  for (const config of Object.values(DOOR_OPERATIONS)) {
    assert.ok(allowed.includes(config.status), `${config.status} is not a valid entry status`);
    assert.ok(
      GUESTLIST_AUDIT_ACTIONS.includes(config.auditAction),
      `${config.auditAction} is not a valid audit action`,
    );
  }
});

test('a no-show gets its own audit action rather than reusing entry_removed', () => {
  assert.equal(DOOR_OPERATIONS.no_show.auditAction, 'marked_no_show');
  assert.equal(DOOR_OPERATIONS.check_in.auditAction, 'checked_in');
});

test('isDoorOperation refuses anything but the two door writes', () => {
  assert.equal(isDoorOperation('check_in'), true);
  assert.equal(isDoorOperation('no_show'), true);
  assert.equal(isDoorOperation('pending'), false);
  assert.equal(isDoorOperation('entry_removed'), false);
  assert.equal(isDoorOperation('constructor'), false);
  assert.equal(isDoorOperation(undefined), false);
});

test('normalizeGuestName collapses the whitespace a name was typed with', () => {
  assert.equal(normalizeGuestName('  Jane   Doe '), 'Jane Doe');
  assert.equal(normalizeGuestName('Jane\tDoe'), 'Jane Doe');
  assert.equal(normalizeGuestName(null), '');
});

test('guestNamesMatch is case- and whitespace-insensitive but never matches empty', () => {
  assert.equal(guestNamesMatch('jane doe', 'Jane  Doe'), true);
  assert.equal(guestNamesMatch('JANE DOE', 'jane doe'), true);
  assert.equal(guestNamesMatch('Jane Doe', 'Jane Does'), false);
  assert.equal(guestNamesMatch('   ', ''), false);
});

test('escapeLikePattern neutralizes ilike wildcards so a name lookup stays exact', () => {
  assert.equal(escapeLikePattern('A_B'), 'A\\_B');
  assert.equal(escapeLikePattern('100%'), '100\\%');
  assert.equal(escapeLikePattern('back\\slash'), 'back\\\\slash');
  assert.equal(escapeLikePattern('Jane Doe'), 'Jane Doe');
});

test('maskPhone shows only the last four digits', () => {
  assert.equal(maskPhone('(512) 555-1234'), '****1234');
  assert.equal(maskPhone('+1 512 555 1234'), '****1234');
  assert.equal(maskPhone('123'), null);
  assert.equal(maskPhone(null), null);
});

test('maskEmail keeps the first character and the domain', () => {
  assert.equal(maskEmail('jane.doe@gmail.com'), 'j****@gmail.com');
  assert.equal(maskEmail('  a@b.co '), 'a****@b.co');
  assert.equal(maskEmail('nope'), null);
  assert.equal(maskEmail('@nope.com'), null);
  assert.equal(maskEmail('nope@'), null);
});

test('maskGuestProfile never puts a real phone or email on the wire', () => {
  const masked = maskGuestProfile({
    id: 'p1',
    full_name: 'Jane Doe',
    phone: '512-555-1234',
    email: 'jane@example.com',
    marketing_consent: true,
    created_at: '2026-01-02T03:04:05Z',
    first_seen_event: { title: 'Neon Night', event_date: '2026-01-02' },
  });

  assert.deepEqual(masked, {
    id: 'p1',
    full_name: 'Jane Doe',
    phone_hint: '****1234',
    email_hint: 'j****@example.com',
    marketing_consent: true,
    created_at: '2026-01-02T03:04:05Z',
    first_seen_event: { title: 'Neon Night', event_date: '2026-01-02' },
  });
  assert.equal(JSON.stringify(masked).includes('5551234'), false);
  assert.equal(JSON.stringify(masked).includes('jane@example.com'), false);
  assert.equal(maskGuestProfile(null), null);
});

test('matchModeFor picks the flow the kiosk should show', () => {
  assert.equal(matchModeFor([], null), 'none');
  assert.equal(matchModeFor([{ id: 'a' }], null), 'single');
  assert.equal(matchModeFor([{ id: 'a' }, { id: 'b' }], null), 'multiple');
  // An existing link outranks a name search, however many names matched.
  assert.equal(matchModeFor([{ id: 'a' }, { id: 'b' }], { id: 'linked' }), 'linked');
});

test('validateGuestIntake requires a real phone and a real email; signature is optional', () => {
  assert.equal(validateGuestIntake({ phone: '512', email: 'a@b.co' }).valid, false);
  assert.equal(validateGuestIntake({ phone: '5125551234', email: 'nope' }).valid, false);
  assert.equal(validateGuestIntake({ phone: '5125551234', email: 'a@b' }).valid, false);
  assert.equal(validateGuestIntake(null).valid, false);
  // 2026-09: signature is no longer required at the door. The trial-pass
  // intake carries the release for everyone going forward, and the guest-list
  // flow serves the residual partner-added-guest case where we just need
  // phone + email to build a profile.
  assert.equal(validateGuestIntake({ phone: '5125551234', email: 'a@b.co' }).valid, true);
});

// A signature IS still accepted when supplied (a future partner-side handoff
// or a re-enabled opt-in flow might pass one), but a malformed data URL is
// still rejected so we do not file garbage into storage.
test('validateGuestIntake still rejects a malformed signature when one is supplied', () => {
  const result = validateGuestIntake({
    phone: '5125551234',
    email: 'a@b.co',
    signature: 'not-a-data-url',
  });
  assert.equal(result.valid, false);
});

test('validateGuestIntake will not accept the old marketing_consent flag as consent', () => {
  // A stale kiosk sending marketing_consent:true with no signature must not
  // silently produce a consented profile. Since signature is now optional, the
  // intake IS valid, but the marketing_consent flag from the client is
  // ignored: the server always derives consent from whether a signature was
  // actually captured.
  const result = validateGuestIntake({
    phone: '5125551234',
    email: 'a@b.co',
    marketing_consent: true,
  });
  assert.equal(result.valid, true);
  assert.equal(result.data.marketing_consent, false);
  assert.equal(result.data.signature, null);
});

test('validateGuestIntake normalizes phone + email; no-signature is the default path', () => {
  const { valid, data } = validateGuestIntake({
    phone: ' (512) 555-1234 ',
    email: '  Jane.Doe@Example.COM ',
  });
  assert.equal(valid, true);
  assert.deepEqual(data, {
    phone: '(512) 555-1234',
    email: 'jane.doe@example.com',
    // No signature = no evidenced consent, so marketing_consent is false.
    marketing_consent: false,
    signature: null,
  });
});

test('validateGuestIntake keeps the signature path working when one is supplied', () => {
  const { valid, data } = validateGuestIntake({
    phone: '5125551234',
    email: 'a@b.co',
    signature: SIGNATURE,
  });
  assert.equal(valid, true);
  assert.equal(data.marketing_consent, true);
  assert.equal(data.signature, SIGNATURE);
});

const ROSTER = [
  { id: '1', guest_name: 'Jane Doe', status: 'pending' },
  { id: '2', guest_name: 'Janet Rodriguez', status: 'pending' },
  { id: '3', guest_name: 'Jane Doe', status: 'checked_in' },
  { id: '4', guest_name: 'Bo Diddley', status: 'no_show' },
  { id: '5', guest_name: 'Sam Jane', status: 'pending' },
];

test('filterRoster requires every token but not their order', () => {
  // "Janet Rodriguez" contains both "jane" and "d", so it matches too — just
  // below the two full-prefix hits.
  assert.deepEqual(filterRoster(ROSTER, 'jane d').map((e) => e.id), ['1', '3', '2']);
  assert.deepEqual(filterRoster(ROSTER, 'd jane').map((e) => e.id), ['1', '3', '2']);
  assert.deepEqual(filterRoster(ROSTER, 'zzz'), []);
});

test('filterRoster ranks by relevance, then pending ahead of already-processed', () => {
  assert.deepEqual(filterRoster(ROSTER, 'jane doe').map((e) => e.id), ['1', '3']);
  // Name-prefix hits first (pending '1' and '2' ahead of the checked-in
  // namesake '3'), then "Sam Jane", which only matches on a later word.
  assert.deepEqual(filterRoster(ROSTER, 'jane').map((e) => e.id), ['1', '2', '3', '5']);
});

test('filterRoster with no query returns everyone, pending first then alphabetical', () => {
  assert.deepEqual(filterRoster(ROSTER, '  ').map((e) => e.id), ['1', '2', '5', '3', '4']);
  assert.deepEqual(filterRoster(null, 'jane'), []);
});

test('summarizeRoster counts the three statuses', () => {
  assert.deepEqual(summarizeRoster(ROSTER), { total: 5, pending: 3, checked_in: 1, no_show: 1 });
  assert.deepEqual(summarizeRoster(null), { total: 0, pending: 0, checked_in: 0, no_show: 0 });
});

test('pickDefaultEventId prefers tonight, then last night, then the next one up', () => {
  const events = [
    { id: 'past', event_date: '2026-07-27' },
    { id: 'yesterday', event_date: '2026-07-28' },
    { id: 'today', event_date: '2026-07-29' },
    { id: 'future', event_date: '2026-08-01' },
  ];
  assert.equal(pickDefaultEventId(events, '2026-07-29'), 'today');
  // A shift that runs past midnight is still working last night's list.
  assert.equal(pickDefaultEventId(events.filter((e) => e.id !== 'today'), '2026-07-29'), 'yesterday');
  assert.equal(pickDefaultEventId([{ id: 'future', event_date: '2026-08-01' }], '2026-07-29'), 'future');
  assert.equal(pickDefaultEventId([], '2026-07-29'), null);
});

test('rosterWindowStart backs up one day, across month boundaries', () => {
  assert.equal(rosterWindowStart('2026-07-29'), '2026-07-28');
  assert.equal(rosterWindowStart('2026-08-01'), '2026-07-31');
  assert.equal(rosterWindowStart('2026-03-01'), '2026-02-28');
  assert.equal(rosterWindowStart('nonsense'), 'nonsense');
});

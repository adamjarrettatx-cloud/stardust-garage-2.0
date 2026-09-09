// The front-desk "Checked in" panel showed a header and a count but never any
// people: it was fed by a browser-memory ring buffer, so it started empty on
// every page load and could not see a check-in made on the door tablet. These
// tests cover the normalizers and the merge that let the panel read server
// truth instead, plus the id conventions that keep a live scan from rendering
// twice (once from the local buffer, once from the next poll).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHECKIN_FEED_MAX,
  ADMITTING_TICKET_RESULTS,
  ADMITTING_TRIAL_PASS_RESULTS,
  normalizeGuestlistRow,
  normalizeTicketRow,
  normalizeTrialPassRow,
  mergeCheckinFeed,
} from '../lib/capacity/checkin-feed.js';

const AT = '2026-09-09T21:27:53.348Z';
const AT_MS = new Date(AT).getTime();

// ---- Guest list -----------------------------------------------------------

test('guest-list row becomes an admitted entry with the partner as detail', () => {
  const entry = normalizeGuestlistRow(
    { id: 'e1', guest_name: 'Ada Lovelace', status: 'checked_in', checked_in_at: AT },
    { partnerName: 'Floppy Disko' },
  );
  assert.deepEqual(entry, {
    id: 'guestlist:e1',
    kind: 'guestlist',
    name: 'Ada Lovelace',
    detail: 'Floppy Disko',
    result: 'admitted',
    at: AT_MS,
  });
});

test('guest-list row falls back to "Guest list" when there is no partner', () => {
  const entry = normalizeGuestlistRow({ id: 'e1', guest_name: 'Ada', checked_in_at: AT }, {});
  assert.equal(entry.detail, 'Guest list');
});

test('guest-list row without a check-in time is dropped', () => {
  assert.equal(normalizeGuestlistRow({ id: 'e1', guest_name: 'Ada', checked_in_at: null }), null);
  assert.equal(normalizeGuestlistRow(null), null);
});

// ---- Tickets --------------------------------------------------------------

test('ticket row takes its name from the order buyer', () => {
  const entry = normalizeTicketRow(
    { ticket_id: 't1', result: 'valid', scanned_at: AT },
    { buyerName: 'Dakota Boyle', buyerEmail: 'info@floppydisko.com' },
  );
  assert.equal(entry.id, 'ticket:t1');
  assert.equal(entry.kind, 'ticket');
  assert.equal(entry.name, 'Dakota Boyle');
  assert.equal(entry.at, AT_MS);
});

test('ticket row falls back to the buyer email, then to a placeholder', () => {
  const noName = normalizeTicketRow(
    { ticket_id: 't1', result: 'valid', scanned_at: AT },
    { buyerName: '   ', buyerEmail: 'info@floppydisko.com' },
  );
  assert.equal(noName.name, 'info@floppydisko.com');
  const nothing = normalizeTicketRow({ ticket_id: 't1', result: 'valid', scanned_at: AT }, {});
  assert.equal(nothing.name, 'Ticket holder');
});

test('an override redemption is labelled as one', () => {
  const entry = normalizeTicketRow({ ticket_id: 't1', result: 'override', scanned_at: AT }, {});
  assert.equal(entry.detail, 'Ticket · override');
});

test('only valid and override ticket results admit anyone', () => {
  assert.deepEqual(ADMITTING_TICKET_RESULTS, ['valid', 'override']);
  for (const result of ['already_used', 'wrong_event', 'not_found', 'refunded', 'void', 'rejected']) {
    assert.equal(
      normalizeTicketRow({ ticket_id: 't1', result, scanned_at: AT }, { buyerName: 'X' }),
      null,
      `${result} must not appear in the checked-in list`,
    );
  }
});

// ---- Trial passes ---------------------------------------------------------

test('trial-pass row uses the pass holder name', () => {
  const entry = normalizeTrialPassRow(
    { trial_pass_id: 'p1', result: 'allowed', checked_in_at: AT },
    { fullName: 'Grace Hopper' },
  );
  assert.equal(entry.id, 'trial:p1');
  assert.equal(entry.kind, 'trial_pass');
  assert.equal(entry.name, 'Grace Hopper');
  assert.equal(entry.detail, 'Trial pass');
});

test('only an allowed trial-pass scan admits anyone', () => {
  assert.deepEqual(ADMITTING_TRIAL_PASS_RESULTS, ['allowed']);
  for (const result of ['denied_expired', 'denied_used', 'rejected', 'denied']) {
    assert.equal(normalizeTrialPassRow({ trial_pass_id: 'p1', result, checked_in_at: AT }, {}), null);
  }
});

// ---- Merge ----------------------------------------------------------------

const server = (id, at) => ({ id, kind: 'ticket', name: 'S', detail: 'Ticket', result: 'admitted', at });
const local = (id, at, extra = {}) => ({
  id, kind: 'ticket', name: 'L', detail: 'Ticket', result: 'admitted', at, ...extra,
});

test('merge sorts newest first', () => {
  const out = mergeCheckinFeed([server('a', 100), server('c', 300), server('b', 200)], []);
  assert.deepEqual(out.map((e) => e.id), ['c', 'b', 'a']);
});

test('a live scan does not render twice once the poll catches up', () => {
  const out = mergeCheckinFeed([server('ticket:t1', 100)], [local('ticket:t1', 999)]);
  assert.equal(out.length, 1);
});

test('the local entry wins so its scan photo survives, but keeps the server time', () => {
  const out = mergeCheckinFeed(
    [server('ticket:t1', 100)],
    [local('ticket:t1', 999, { photoUrl: 'https://signed/photo.jpg' })],
  );
  assert.equal(out[0].photoUrl, 'https://signed/photo.jpg');
  assert.equal(out[0].name, 'L');
  assert.equal(out[0].at, 100, 'server timestamp is authoritative over the browser clock');
});

test('a local entry with no server counterpart keeps its own timestamp', () => {
  const out = mergeCheckinFeed([], [local('member:m1', 999)]);
  assert.equal(out[0].at, 999);
});

test('merge drops anything that was not admitted', () => {
  const denied = { id: 'x', kind: 'ticket', name: 'X', result: 'denied', at: 500 };
  const out = mergeCheckinFeed([server('a', 100)], [denied]);
  assert.deepEqual(out.map((e) => e.id), ['a']);
});

test('merge caps the list and never mutates its inputs', () => {
  const serverRows = Array.from({ length: 80 }, (_, i) => server(`s${i}`, i));
  const frozen = JSON.stringify(serverRows);
  const out = mergeCheckinFeed(serverRows, []);
  assert.equal(out.length, CHECKIN_FEED_MAX);
  assert.equal(out[0].id, 's79');
  assert.equal(JSON.stringify(serverRows), frozen);
});

test('merge tolerates missing, non-array and malformed input', () => {
  assert.deepEqual(mergeCheckinFeed(undefined, undefined), []);
  assert.deepEqual(mergeCheckinFeed(null, 'nope'), []);
  assert.deepEqual(mergeCheckinFeed([null, { name: 'no id' }], [undefined]), []);
});

// ---- Wiring guards --------------------------------------------------------
//
// The ids are the contract between the scanner and the feed. If either side
// renames its prefix the panel silently starts double-rendering every scan,
// which is exactly the sort of thing nobody notices until a busy door.

test('the scanner and the feed agree on the entry id prefixes', () => {
  const scanner = readFileSync(new URL('../app/capacity/components/UnifiedDoorScanner.js', import.meta.url), 'utf8');
  for (const prefix of ['ticket:', 'member:', 'trial:']) {
    assert.ok(scanner.includes(`activityId: \`${prefix}`), `scanner should build ${prefix} ids`);
  }
  const guestlistEntry = normalizeGuestlistRow({ id: 'x', guest_name: 'g', checked_in_at: AT });
  assert.ok(guestlistEntry.id.startsWith('guestlist:'));
  const ticketEntry = normalizeTicketRow({ ticket_id: 'x', result: 'valid', scanned_at: AT }, {});
  assert.ok(ticketEntry.id.startsWith('ticket:'));
  const trialEntry = normalizeTrialPassRow({ trial_pass_id: 'x', result: 'allowed', checked_in_at: AT }, {});
  assert.ok(trialEntry.id.startsWith('trial:'));
});

test('the front desk renders the merged feed, not the raw local buffer', () => {
  const client = readFileSync(new URL('../app/capacity/front-desk/FrontDeskClient.js', import.meta.url), 'utf8');
  assert.ok(client.includes('mergeCheckinFeed('), 'must merge server truth with the local buffer');
  assert.ok(client.includes('/api/capacity/checkins'), 'must seed the list from the server');
  assert.ok(
    /checkedInHistory = useMemo/.test(client),
    'the rendered list must be derived, not a bare useState buffer',
  );
});

test('the checkins route is team-gated and scoped to a door session', () => {
  const route = readFileSync(new URL('../app/api/capacity/checkins/route.js', import.meta.url), 'utf8');
  assert.ok(route.includes('requireTeam('), 'door staff only');
  assert.ok(route.includes('getActiveDoorSession('), 'scope to the open door session');
  assert.ok(route.includes('door_session_id'), 'ticket and trial rows scope by session');
});

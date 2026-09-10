// A denial at the door used to exist only on the scanner's red result card,
// which clears itself after five seconds. If a guest was refused and drifted
// back later to a different door person, nothing on screen said so. These tests
// cover the pure helpers behind the fix: the denying-result vocabulary (which
// must stay in step with the DB CHECK constraints), the human labels, and the
// summary/banner that tell the door "this person has been turned away before".

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DENYING_TICKET_RESULTS,
  DENYING_TRIAL_PASS_RESULTS,
  DENYING_MEMBER_ID_RESULTS,
  isDenyingResult,
  denialLabel,
  summarizeDenialHistory,
  relativeAge,
  priorDenialBanner,
} from '../lib/capacity/denial-history.js';
import {
  ADMITTING_TICKET_RESULTS,
  ADMITTING_TRIAL_PASS_RESULTS,
  normalizeDenialRow,
  normalizeMemberIdRow,
  mergeCheckinFeed,
} from '../lib/capacity/checkin-feed.js';

// ---- Vocabulary completeness ---------------------------------------------
//
// Every value the DB CHECK constraint allows must be classified as either
// admitting or denying. A result that is in neither list is silently dropped
// from the feed, which is exactly the class of bug this feature fixes.

const TICKET_RESULTS = [
  'valid', 'already_used', 'refunded', 'void', 'wrong_event',
  'not_found', 'override', 'rejected',
];
const TRIAL_PASS_RESULTS = [
  'allowed', 'denied_expired', 'denied_ineligible_event', 'denied_duplicate', 'rejected',
];

test('every ticket_checkins result is either admitting or denying', () => {
  for (const result of TICKET_RESULTS) {
    const admits = ADMITTING_TICKET_RESULTS.includes(result);
    const denies = DENYING_TICKET_RESULTS.includes(result);
    assert.ok(admits || denies, `${result} is classified as neither`);
    assert.ok(!(admits && denies), `${result} is classified as both`);
  }
});

test('every trial_pass_checkins result is either admitting or denying', () => {
  for (const result of TRIAL_PASS_RESULTS) {
    const admits = ADMITTING_TRIAL_PASS_RESULTS.includes(result);
    const denies = DENYING_TRIAL_PASS_RESULTS.includes(result);
    assert.ok(admits || denies, `${result} is classified as neither`);
    assert.ok(!(admits && denies), `${result} is classified as both`);
  }
});

test('member_id_scans: verified admits, rejected denies', () => {
  assert.deepEqual(DENYING_MEMBER_ID_RESULTS, ['rejected']);
  assert.equal(isDenyingResult('member_id', 'verified'), false);
  assert.equal(isDenyingResult('member_id', 'rejected'), true);
});

test('isDenyingResult does not leak results across sources', () => {
  // 'denied_expired' is a trial-pass result and means nothing on a ticket.
  assert.equal(isDenyingResult('trial_pass', 'denied_expired'), true);
  assert.equal(isDenyingResult('ticket', 'denied_expired'), false);
  assert.equal(isDenyingResult('ticket', 'wrong_event'), true);
  assert.equal(isDenyingResult('trial_pass', 'wrong_event'), false);
  assert.equal(isDenyingResult('nonsense', 'rejected'), false);
});

// ---- Labels ---------------------------------------------------------------

test('a staff rejection shows the reason, not the bare word', () => {
  // "Rejected by staff" tells the next door person nothing actionable.
  assert.equal(denialLabel('rejected', 'photo_mismatch'), 'Rejected · Photo mismatch');
  assert.equal(denialLabel('rejected', 'no_photo_on_file'), 'Rejected · No photo on file');
  assert.equal(denialLabel('rejected', null), 'Rejected by staff');
});

test('automatic denials use their result label', () => {
  assert.equal(denialLabel('already_used'), 'Already used');
  assert.equal(denialLabel('wrong_event'), 'Wrong event');
  assert.equal(denialLabel('denied_expired'), 'Pass expired');
  assert.equal(denialLabel('denied_ineligible_event'), 'Not eligible for this event');
});

test('an unknown reject_reason falls through as its raw code', () => {
  // Better a door person sees "some_new_code" than a blank line, and it makes
  // a missing label obvious rather than invisible.
  assert.equal(denialLabel('rejected', 'some_new_code'), 'Rejected · some_new_code');
});

test('an unrecognised result still labels as denied rather than blank', () => {
  assert.equal(denialLabel('brand_new_result'), 'Denied');
});

// ---- Summary --------------------------------------------------------------

const HOUR = 3600000;

test('no history returns null so the caller can skip the banner', () => {
  assert.equal(summarizeDenialHistory([]), null);
  assert.equal(summarizeDenialHistory(null), null);
  // Rows without a usable timestamp cannot be placed in a history.
  assert.equal(summarizeDenialHistory([{ at: null, label: 'x' }]), null);
});

test('summary counts tonight separately from all-time', () => {
  const now = Date.now();
  const sessionStartMs = now - 4 * HOUR;
  const summary = summarizeDenialHistory([
    { at: now - 30 * 60000, label: 'Wrong event' },
    { at: now - 2 * HOUR, label: 'Rejected · Photo mismatch' },
    { at: now - 200 * 24 * HOUR, label: 'Pass expired' },
  ], { sessionStartMs });
  assert.equal(summary.total, 3);
  assert.equal(summary.tonight, 2);
  // Newest first regardless of input order.
  assert.equal(summary.lastLabel, 'Wrong event');
  assert.deepEqual(summary.reasons, ['Wrong event', 'Rejected · Photo mismatch', 'Pass expired']);
});

test('summary sorts newest-first even when given oldest-first rows', () => {
  const now = Date.now();
  const summary = summarizeDenialHistory([
    { at: now - 5 * HOUR, label: 'Pass expired' },
    { at: now - 1 * HOUR, label: 'Wrong event' },
  ]);
  assert.equal(summary.lastLabel, 'Wrong event');
  assert.equal(summary.lastAt, now - 1 * HOUR);
});

test('repeated reasons are deduped in the reason list', () => {
  const now = Date.now();
  const summary = summarizeDenialHistory([
    { at: now - HOUR, label: 'Wrong event' },
    { at: now - 2 * HOUR, label: 'Wrong event' },
  ]);
  assert.equal(summary.total, 2, 'both denials still count');
  assert.deepEqual(summary.reasons, ['Wrong event'], 'but the cause is listed once');
});

test('without a session start nothing is attributed to tonight', () => {
  const summary = summarizeDenialHistory([{ at: Date.now(), label: 'Wrong event' }]);
  assert.equal(summary.tonight, 0);
});

// ---- Relative age ---------------------------------------------------------

test('relativeAge is coarse on purpose', () => {
  const now = Date.now();
  assert.equal(relativeAge(now, now), 'just now');
  assert.equal(relativeAge(now - 20 * 60000, now), '20 min ago');
  assert.equal(relativeAge(now - 3 * HOUR, now), '3 hr ago');
  assert.equal(relativeAge(now - 30 * HOUR, now), 'yesterday');
  assert.equal(relativeAge(now - 6 * 24 * HOUR, now), '6 days ago');
});

test('a future timestamp does not render a negative age', () => {
  // Client and server clocks disagree; the door should not read "-3 min ago".
  const now = Date.now();
  assert.equal(relativeAge(now + 5 * 60000, now), 'just now');
});

// ---- Banner ---------------------------------------------------------------

test('banner leads with tonight when there were denials tonight', () => {
  const now = Date.now();
  const summary = summarizeDenialHistory([
    { at: now - 20 * 60000, label: 'Rejected · Photo mismatch' },
    { at: now - 90 * 60000, label: 'Wrong event' },
  ], { sessionStartMs: now - 4 * HOUR });
  const banner = priorDenialBanner(summary, now);
  assert.match(banner, /2 times tonight/);
  assert.match(banner, /20 min ago/);
  assert.match(banner, /Photo mismatch/);
});

test('banner says "once" rather than "1 times"', () => {
  const now = Date.now();
  const tonight = summarizeDenialHistory(
    [{ at: now - 10 * 60000, label: 'Wrong event' }],
    { sessionStartMs: now - HOUR },
  );
  assert.match(priorDenialBanner(tonight, now), /once tonight/);
  const older = summarizeDenialHistory([{ at: now - 40 * 24 * HOUR, label: 'Pass expired' }]);
  assert.match(priorDenialBanner(older, now), /once before/);
});

test('banner falls back to all-time when nothing happened tonight', () => {
  const now = Date.now();
  const summary = summarizeDenialHistory([
    { at: now - 40 * 24 * HOUR, label: 'Pass expired' },
    { at: now - 90 * 24 * HOUR, label: 'Wrong event' },
  ], { sessionStartMs: now - HOUR });
  const banner = priorDenialBanner(summary, now);
  assert.match(banner, /2 times before/);
  assert.ok(!banner.includes('tonight'));
});

test('banner is null for no summary', () => {
  assert.equal(priorDenialBanner(null), null);
});

// ---- Feed integration ----------------------------------------------------
//
// The id convention is the whole reason denials can accumulate at all, so it
// is asserted here rather than left to the route.

test('denials are keyed by scan, not by subject', () => {
  const now = Date.now();
  const a = normalizeDenialRow({
    id: 'row-1', at: now - HOUR, kind: 'ticket', name: 'Gary', label: 'Wrong event',
  });
  const b = normalizeDenialRow({
    id: 'row-2', at: now, kind: 'ticket', name: 'Gary', label: 'Already used',
  });
  assert.equal(a.id, 'scan:row-1');
  assert.equal(b.id, 'scan:row-2');
  // Two refusals of the same person are two rows. If these collapsed, the
  // repeat-attempt history Adam asked for would not exist.
  const merged = mergeCheckinFeed([a, b], []);
  assert.equal(merged.length, 2);
});

test('a denial followed by an admit of the same ticket keeps both rows', () => {
  const now = Date.now();
  const denial = normalizeDenialRow({
    id: 'row-9', at: now - 30 * 60000, kind: 'ticket', name: 'Gary', label: 'Wrong event',
  });
  const admit = {
    id: 'ticket:t-1', kind: 'ticket', name: 'Gary', detail: 'Ticket redeemed',
    result: 'admitted', at: now,
  };
  const merged = mergeCheckinFeed([denial], [admit]);
  assert.equal(merged.length, 2, 'the earlier refusal is still visible after they get in');
  assert.equal(merged[0].id, 'ticket:t-1', 'newest first');
  assert.equal(merged[1].result, 'denied');
});

test('mergeCheckinFeed no longer drops denials', () => {
  // It used to filter to result === 'admitted', which is why the front desk
  // could not show a denial at all.
  const now = Date.now();
  const merged = mergeCheckinFeed([
    { id: 'scan:1', kind: 'ticket', name: 'A', result: 'denied', at: now },
    { id: 'scan:2', kind: 'ticket', name: 'B', result: 'rejected', at: now - 1000 },
    { id: 'ticket:3', kind: 'ticket', name: 'C', result: 'admitted', at: now - 2000 },
  ], []);
  assert.deepEqual(merged.map((e) => e.result), ['denied', 'rejected', 'admitted']);
});

test('normalizeDenialRow rejects unusable rows instead of rendering blanks', () => {
  const now = Date.now();
  assert.equal(normalizeDenialRow({ id: null, at: now, kind: 'ticket', label: 'x' }), null);
  assert.equal(normalizeDenialRow({ id: 'r', at: null, kind: 'ticket', label: 'x' }), null);
});

test('a denial with no name shows what kind of credential it was', () => {
  // A not_found ticket scan has no order and therefore no buyer name; the row
  // still has to say something a person can read.
  const row = normalizeDenialRow({
    id: 'r', at: Date.now(), kind: 'trial_pass', name: null, label: 'Pass expired',
  });
  assert.equal(row.name, 'Trial pass');
  assert.equal(row.detail, 'Pass expired');
  assert.equal(row.result, 'denied');
});

test('member ID verifies normalize as admits and survive a refresh', () => {
  // These were previously local-only, so a member verified on the door tablet
  // never appeared on the front-desk laptop.
  const row = normalizeMemberIdRow(
    { member_profile_id: 'mp-1', result: 'verified', scanned_at: new Date().toISOString() },
    { fullName: 'Dakota Reed' },
  );
  assert.equal(row.id, 'member:mp-1');
  assert.equal(row.kind, 'member_id');
  assert.equal(row.result, 'admitted');
  assert.equal(row.name, 'Dakota Reed');
});

test('normalizeMemberIdRow ignores rejections', () => {
  // Rejections go through normalizeDenialRow so they get a scan-keyed id.
  const row = normalizeMemberIdRow(
    { member_profile_id: 'mp-1', result: 'rejected', scanned_at: new Date().toISOString() },
  );
  assert.equal(row, null);
});

// ---- Source guards -------------------------------------------------------

test('the front-desk buffer no longer filters denials out', () => {
  const src = readFileSync(new URL('../app/capacity/front-desk/FrontDeskClient.js', import.meta.url), 'utf8');
  assert.ok(
    !/if \(entry\?\.result === 'admitted'\) \{/.test(src),
    'logActivity must accept denials, not only admits',
  );
});

test('the scanner keys denial activity on the scan row id', () => {
  const src = readFileSync(new URL('../app/capacity/components/UnifiedDoorScanner.js', import.meta.url), 'utf8');
  assert.ok(src.includes('denialActivityId'), 'denial ids come from a dedicated helper');
  assert.ok(
    src.includes('json.checkin_id'),
    'the helper must be fed the scan row id the endpoints now return',
  );
});

test('all three scan endpoints return the check-in row id', () => {
  for (const path of [
    '../app/api/tickets/scan/route.js',
    '../app/api/capacity/trial-pass/scan/route.js',
    '../app/api/scan/member-id/route.js',
  ]) {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(src.includes('checkin_id'), `${path} must return checkin_id`);
    assert.ok(src.includes("select('id')"), `${path} must select the inserted id`);
  }
});

test('all three preview modes return prior denials', () => {
  for (const path of [
    '../app/api/tickets/scan/route.js',
    '../app/api/capacity/trial-pass/scan/route.js',
    '../app/api/scan/member-id/route.js',
  ]) {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(src.includes('prior_denials'), `${path} must return prior_denials`);
    assert.ok(
      src.includes('fetchPriorDenials'),
      `${path} must look up history via the shared helper`,
    );
  }
});

test('a failed history lookup can never block the door', () => {
  // Admitting a paying guest must not depend on a nice-to-have history read.
  for (const path of [
    '../app/api/tickets/scan/route.js',
    '../app/api/capacity/trial-pass/scan/route.js',
    '../app/api/scan/member-id/route.js',
  ]) {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8');
    // The call site, not the import at the top of the file.
    const idx = src.indexOf('await fetchPriorDenials');
    assert.ok(idx > 0, `${path} must call fetchPriorDenials`);
    const before = src.slice(Math.max(0, idx - 400), idx);
    assert.ok(/try \{/.test(before), `${path} must wrap fetchPriorDenials in try/catch`);
  }
});

test('the checkins feed reads denials from all three scan tables', () => {
  const src = readFileSync(new URL('../app/api/capacity/checkins/route.js', import.meta.url), 'utf8');
  for (const table of ['ticket_checkins', 'trial_pass_checkins', 'member_id_scans']) {
    assert.ok(src.includes(`.from('${table}')`), `feed must query ${table}`);
  }
  for (const list of [
    'DENYING_TICKET_RESULTS',
    'DENYING_TRIAL_PASS_RESULTS',
    'DENYING_MEMBER_ID_RESULTS',
  ]) {
    assert.ok(src.includes(list), `feed must include ${list} in its result filter`);
  }
});

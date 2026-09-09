import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pushRecentActivity } from '../lib/scan/recent-activity.js';

// Guardrails for the chronological check-in list under the trial-pass panel.
// The panel is fed by a longer-lived buffer (checkedInHistory) that mirrors
// only admitted entries, so a denial or rejection at the door cannot appear
// in the "checked in tonight" list.

const src = readFileSync(
  new URL('../app/capacity/front-desk/FrontDeskClient.js', import.meta.url),
  'utf8',
);
const scannerSrc = readFileSync(
  new URL('../app/capacity/components/UnifiedDoorScanner.js', import.meta.url),
  'utf8',
);

test('checkedInHistory only accumulates admitted entries', () => {
  // Simulate the reducer contract from logActivity.
  const admit = { id: 'a1', kind: 'ticket', name: 'A', result: 'admitted', at: 1, photoUrl: 'x' };
  const deny  = { id: 'd1', kind: 'trial_pass', name: 'D', result: 'denied',  at: 2 };
  const rej   = { id: 'r1', kind: 'member_id', name: 'R', result: 'rejected', at: 3 };
  let history = [];
  for (const e of [admit, deny, rej]) {
    if (e.result === 'admitted') history = pushRecentActivity(history, e, 50);
  }
  assert.equal(history.length, 1);
  assert.equal(history[0].id, 'a1');
  assert.equal(history[0].photoUrl, 'x');
});

test('checkedInHistory keeps the newest 50 across a busy night', () => {
  let history = [];
  for (let i = 0; i < 75; i++) {
    history = pushRecentActivity(
      history,
      { id: `g${i}`, kind: 'guestlist', name: `Guest ${i}`, result: 'admitted', at: i },
      50,
    );
  }
  assert.equal(history.length, 50);
  // Newest first: last inserted should be at [0].
  assert.equal(history[0].id, 'g74');
  assert.equal(history[49].id, 'g25');
});

test('FrontDeskClient wires CheckedInListPanel under the trial-pass panel', () => {
  // The panel has to render inside the AuthenticatedThemeProvider block so
  // its dark styling matches, and it must receive the merged checked-in list.
  //
  // checkedInHistory started life as a plain useState ring buffer, which meant
  // the panel only ever knew about check-ins made in that one browser tab. It
  // is now derived: the server feed merged with the local buffer. These checks
  // assert that shape rather than the old internals.
  assert.match(src, /const checkedInHistory = useMemo\(/);
  assert.match(src, /mergeCheckinFeed\(serverCheckedIn, localCheckedIn\)/);
  assert.match(src, /setLocalCheckedIn\(\(prev\) => pushRecentActivity\(prev, entry, CHECKIN_FEED_MAX\)\);/);
  assert.match(src, /<CheckedInListPanel entries=\{checkedInHistory\} \/>/);
  assert.match(src, /function CheckedInListPanel\(/);
  assert.match(src, /function CheckedInRow\(/);
});

test('CheckedInRow falls back to a monogram avatar when no photo is on file', () => {
  // The regex looks for the ternary branch: photoUrl ? <img> : <div>monogram</div>
  assert.match(src, /entry\.photoUrl \? \(/);
  assert.match(src, /function monogram\(name\)/);
});

test('UnifiedDoorScanner forwards preview.photoUrl on every admit activity', () => {
  // Without this line, the check-in list has no photos for scans (only for
  // guest-list check-ins, which never have a signed URL anyway).
  assert.match(scannerSrc, /photoUrl: preview\.photoUrl \|\| null,/);
});

test('DoorSessionBar no longer spells out what the scanner is scanning', () => {
  // Adam pulled the "Scanning tickets, members, and trial passes" copy to
  // give the check-in list more room. Regression guard so it does not sneak
  // back in via a copy-paste from an older layout.
  assert.doesNotMatch(src, /Scanning tickets, members, and trial passes/);
});

test('ManualTrialPassForm is rendered in compact mode inside the front-desk', () => {
  assert.match(src, /<ManualTrialPassForm createdByEmail=\{staffEmail\} compact \/>/);
});

// Source-level regression tests for notification wiring.
//
// Same pattern as other wiring tests in this repo: assert the shape of the
// files, not runtime behavior. If any of these assertions fail it means the
// notification triggers drifted and users will stop receiving them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// Sender
// ---------------------------------------------------------------------------

test('notify() exports notify and notifyMany', () => {
  const src = read('lib/notifications/send.js');
  assert.match(src, /export async function notify\(/);
  assert.match(src, /export async function notifyMany\(/);
});

test('sender never throws \u2014 every external call wrapped in try/catch', () => {
  const src = read('lib/notifications/send.js');
  // in_app write, email send, and pref lookup each in try/catch
  const tryCount = (src.match(/try\s*\{/g) || []).length;
  assert.ok(tryCount >= 4, `expected \u22654 try blocks, got ${tryCount}`);
});

test('sender forces in_app on via effectiveChannels', () => {
  const src = read('lib/notifications/send.js');
  assert.match(src, /effectiveChannels/);
});

test('sender writes to notifications table', () => {
  const src = read('lib/notifications/send.js');
  assert.match(src, /from\('notifications'\)/);
  assert.match(src, /\.insert\(\{/);
});

test('sender invokes the versioned send-push Edge Function', () => {
  const src = read('lib/notifications/send.js');
  assert.match(src, /export async function sendPushToUser/);
  assert.match(src, /functions\.invoke\('send-push'/);
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

test('feed route requires auth and filters by user_id', () => {
  const src = read('app/api/notifications/route.js');
  assert.match(src, /getCurrentUser/);
  assert.match(src, /Unauthorized/);
  assert.match(src, /\.eq\('user_id', user\.id\)/);
});

test('mark-read route enforces ownership', () => {
  const src = read('app/api/notifications/[id]/route.js');
  assert.match(src, /getCurrentUser/);
  // ownership guard \u2014 the .eq('user_id', user.id) MUST be present so
  // Adam can't mark someone else's row read by guessing the id.
  assert.match(src, /\.eq\('user_id', user\.id\)/);
});

test('preferences PATCH rejects non-user-configurable types', () => {
  const src = read('app/api/notifications/preferences/route.js');
  assert.match(src, /userConfigurable/);
  assert.match(src, /cannot be turned off/);
});

test('unread-count is cheap (head:true count)', () => {
  const src = read('app/api/notifications/unread-count/route.js');
  assert.match(src, /count:\s*'exact'/);
  assert.match(src, /head:\s*true/);
});

test('broadcast is admin-only', () => {
  const src = read('app/api/admin/notifications/broadcast/route.js');
  assert.match(src, /requireAdmin/);
  assert.match(src, /Forbidden/);
});

// ---------------------------------------------------------------------------
// Trigger points
// ---------------------------------------------------------------------------

test('member-id verify fires door_checkin notification', () => {
  const src = read('app/api/scan/member-id/route.js');
  assert.match(src, /notify.*door_checkin/s);
  // Should be wrapped so a failure doesn't 500 the door.
  const notifyIdx = src.indexOf("type: 'door_checkin'");
  assert.ok(notifyIdx > -1);
  // The nearest preceding 'try {' should be within 400 chars
  const preceding = src.slice(Math.max(0, notifyIdx - 400), notifyIdx);
  assert.match(preceding, /try\s*\{/);
});

test('member-id select includes user_id for notification routing', () => {
  const src = read('app/api/scan/member-id/route.js');
  assert.match(src, /select\('id, user_id/);
});

test('trial-pass activation fires trial_activated notification', () => {
  const src = read('app/api/capacity/trial-pass/scan/route.js');
  assert.match(src, /trial_activated/);
  // Guarded on member_profile_id \u2014 no user_id, no notification
  assert.match(src, /pass\.member_profile_id/);
});

// ---------------------------------------------------------------------------
// UI presence
// ---------------------------------------------------------------------------

test('feed page renders NotificationsClient', () => {
  const page = read('app/notifications/page.js');
  assert.match(page, /NotificationsClient/);
  assert.match(page, /getCurrentUser/); // must be auth-gated
});

test('settings page renders SettingsClient with per-type toggles', () => {
  const src = read('app/notifications/settings/SettingsClient.js');
  assert.match(src, /setPref\(t\.id, \{ push: v \}\)/);
  assert.match(src, /Always on/);   // in-app disabled note
});

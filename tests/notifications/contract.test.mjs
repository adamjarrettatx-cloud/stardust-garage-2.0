// Push contract regression tests.
//
// These are deliberately source-level tests: the site routes, Edge Functions,
// and Expo API run in different environments, but the type strings shared by
// all three must never drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const CANONICAL_TYPES = new Set([
  'ticket_purchased',
  'door_checkin',
  'trial_approved',
  'membership_update',
  'admin_broadcast',
  'chat_mention',
]);

function read(relativePath) {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function assertPushCall(relativePath, type) {
  const source = read(relativePath);
  assert.ok(CANONICAL_TYPES.has(type), `${type} must remain a canonical push type`);
  assert.match(
    source,
    new RegExp(`sendPushToUser\\(\\{[\\s\\S]{0,500}?type:\\s*['"]${type}['"]`),
    `${relativePath} must call sendPushToUser with ${type}`,
  );
}

test('the notification helper invokes send-push with the canonical type', () => {
  const source = read('lib/notifications/send.js');
  assert.match(source, /functions\.invoke\('send-push'/);
  assert.match(source, /body:\s*\{\s*user_id:\s*userId,\s*title,\s*body,\s*data,\s*type\s*\}/);
});

test('ticket confirmation emits ticket_purchased', () => {
  assertPushCall('lib/tickets/webhook-handlers.js', 'ticket_purchased');
});

test('door check-in emits door_checkin', () => {
  assertPushCall('app/api/tickets/scan/route.js', 'door_checkin');
});

test('trial approval emits trial_approved', () => {
  assertPushCall('app/api/admin/approve-member/route.js', 'trial_approved');
});

test('membership lifecycle emits membership_update', () => {
  assertPushCall('app/api/stripe/webhook/route.js', 'membership_update');
});

test('broadcast fanout maps each notifyMany recipient to admin_broadcast', () => {
  const broadcast = read('app/api/admin/notifications/broadcast/route.js');
  const sender = read('lib/notifications/send.js');
  assert.match(broadcast, /notifyMany\(admin,\s*userIds/);
  assert.match(broadcast, /pushType:\s*'admin_broadcast'/);
  assert.match(sender, /await sendPushToUser\(\{/);
});

test('chat mention emits chat_mention and no camelCase notification type', () => {
  const source = read('supabase/functions/chat-notify/index.ts');
  assert.match(source, /type:\s*mentioned\s*\?\s*"chat_mention"/);
  assert.doesNotMatch(source, /chatMention/);
});

test('all canonical values are snake_case', () => {
  for (const type of CANONICAL_TYPES) {
    assert.match(type, /^[a-z]+(?:_[a-z]+)*$/);
  }
});

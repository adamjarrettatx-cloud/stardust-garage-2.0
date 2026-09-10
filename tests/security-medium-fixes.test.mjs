import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('M-01 preserves unlisted capability on holds and releases stale public holds', () => {
  const holdRoute = read('app/api/tickets/hold/route.js');
  const fulfillment = read('lib/tickets/fulfillment.js');
  const migration = read('supabase/migrations/20260910010000_hold_share_token.sql');

  assert.match(holdRoute, /share_token:\s*shareToken/);
  assert.match(fulfillment, /currentEvent\?\.visibility === 'public'/);
  assert.match(fulfillment, /hold\.share_token === currentEvent\?\.share_token/);
  assert.match(fulfillment, /releaseAndRefundForVisibilityChange/);
  assert.match(fulfillment, /if \(!holdConsumed\)/);
  assert.match(migration, /add column if not exists share_token text/i);
  assert.match(migration, /released_reason = 'visibility_changed'/);
  assert.match(migration, /perform public\.release_ticket_hold/);
  assert.match(migration, /after update of visibility on public\.events/i);
});

test('M-02 limits and equalizes free-account verification responses', () => {
  const route = read('app/api/free-account/verify/check/route.js');
  assert.match(route, /limit: 10, windowMs: 60 \* 1000/);
  assert.match(route, /limit: 5, windowMs: 60 \* 60 \* 1000/);
  assert.match(route, /hashRateLimitKey\(data\.phone\)/);
  assert.match(route, /hashRateLimitKey\(data\.email_canonical \|\| data\.email\)/);
  assert.doesNotMatch(route, /account_exists/);
});

test('M-03 limits notify and escapes submitted HTML fields without sending confirmations', () => {
  const route = read('app/api/notify/route.js');
  const email = read('lib/email.js');
  assert.match(route, /ALLOWED_FORM_TYPES/);
  assert.match(route, /limit: 5/);
  assert.doesNotMatch(route, /sendUserConfirmation/);
  assert.match(email, /escapeHtml\(label\)/);
  assert.match(email, /escapeHtml\(displayValue\)/);
  assert.match(email, /\.replace\(\/"\/g, '&quot;'\)/);
  assert.match(email, /\.replace\(\/'\/g, '&#39;'\)/);
});

test('M-04 migrates deletion FKs and runs PII cleanup before auth deletion', () => {
  const route = read('app/api/account/delete/route.js');
  const migration = read('supabase/migrations/20260910020000_account_delete_fk_cleanup.sql');
  assert.match(migration, /deleted_user_email text/i);
  assert.match(migration, /on delete set null/i);
  assert.match(route, /waiver acceptance anonymization/);
  assert.match(route, /ticket hold anonymization by user/);
  assert.match(route, /memberPhotoBucket\.list\(user\.id/);
  assert.ok(route.indexOf('waiver acceptance anonymization') < route.indexOf('deleteUser(user.id)'));
  assert.ok(route.indexOf('memberPhotoBucket.list(user.id') < route.indexOf('deleteUser(user.id)'));
});

test('L-02 provides the order id to ticket refund idempotency', () => {
  const route = read('app/api/admin/tickets/orders/[id]/route.js');
  assert.match(route, /orderId:\s*order\.id/);
  assert.doesNotMatch(route, /metadata:\s*\{\s*order_id:/);
});

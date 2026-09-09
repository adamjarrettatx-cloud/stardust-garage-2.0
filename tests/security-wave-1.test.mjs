import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTrialPassIntake } from '../lib/trial-pass.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const freeAccountRoute = read('app/api/free-account/verify/check/route.js');
const broadcastRoute = read('app/api/admin/notifications/broadcast/route.js');
const publishRoute = read('app/api/admin/events/[id]/tt-publish/route.js');
const eventPage = read('app/events/[slug]/page.js');
const notificationMigration = read('supabase/migrations/20260910_notification_broadcasts.sql');
const tokenMigration = read('supabase/migrations/20260910_unlisted_events_share_token.sql');

function loadFreeAccountPost(deps) {
  const source = freeAccountRoute
    .replace(/^import[^\n]+\n/gm, '')
    .replace(/export const (runtime|dynamic) = [^;]+;\n/g, '')
    .replace('export async function POST', 'async function POST');
  return new Function(
    'NextResponse', 'createAdminClient', 'isSupabaseConfigured', 'validateTrialPassIntake',
    'checkVerification', 'isTwilioVerifyConfigured',
    `${source}\nreturn POST;`,
  )(
    { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
    deps.createAdminClient,
    () => true,
    validateTrialPassIntake,
    deps.checkVerification || (async () => ({ ok: true, approved: true })),
    () => true,
  );
}

test('H-05: an existing free-account email returns 409 and never upserts attacker data', async () => {
  let upsertCalls = 0;
  let createUserCalls = 0;
  const freeAccountsQuery = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: { user_id: 'existing-user' }, error: null }; },
    upsert() { upsertCalls += 1; },
  };
  const admin = {
    from(table) {
      assert.equal(table, 'free_accounts');
      return freeAccountsQuery;
    },
    auth: { admin: { async createUser() { createUserCalls += 1; return {}; } } },
  };
  const POST = loadFreeAccountPost({ createAdminClient: () => admin });
  const response = await POST({
    json: async () => ({
      fullName: 'Attacker Supplied Name', email: 'existing@example.com', phone: '(512) 555-1212',
      password: 'correct-horse-battery-staple', code: '123456',
    }),
  });

  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    error: 'account_exists',
    message: 'An account with this email already exists. Please sign in instead.',
  });
  assert.equal(createUserCalls, 0, 'existing-account path must not reconnect auth identity');
  assert.equal(upsertCalls, 0, 'existing-account path must not update free_accounts');
});

test('H-06: broadcast requires explicit audience, UUID idempotency, and both hourly limits', () => {
  assert.match(broadcastRoute, /idempotency-key/);
  assert.match(broadcastRoute, /Idempotency-Key header must be a UUID/);
  assert.match(broadcastRoute, /all_members.*all_team.*all_free_accounts/s);
  assert.match(broadcastRoute, /ticket_holders_event:/);
  assert.match(broadcastRoute, /notification_broadcast:admin:\$\{user\.id\}/);
  assert.match(broadcastRoute, /notification_broadcast:global/);
  assert.match(broadcastRoute, /limit: 5/);
  assert.match(broadcastRoute, /limit: 20/);
  assert.match(broadcastRoute, /from\('notification_broadcasts'\)/);
  assert.doesNotMatch(broadcastRoute, /audience\s*=\s*\{\s*scope:\s*'all'\s*\}/);
});

test('H-06 migration creates a locked-down durable broadcast ledger and tt timestamp', () => {
  assert.match(notificationMigration, /create table if not exists public\.notification_broadcasts/i);
  assert.match(notificationMigration, /idempotency_key uuid unique not null/i);
  assert.match(notificationMigration, /enable row level security/i);
  assert.match(notificationMigration, /revoke all .* from anon, authenticated/i);
  assert.match(notificationMigration, /tt_last_published_at timestamptz/i);
});

test('tt-publish has per-event and per-admin limits, replay guard, and attempt audit', () => {
  assert.match(publishRoute, /tt_publish:event:\$\{id\}/);
  assert.match(publishRoute, /limit: 3/);
  assert.match(publishRoute, /tt_publish:admin:\$\{user\.id\}/);
  assert.match(publishRoute, /limit: 10/);
  assert.match(publishRoute, /tt_last_published_at/);
  assert.match(publishRoute, /force=1/);
  assert.match(publishRoute, /status: 409/);
  assert.match(publishRoute, /notification_broadcasts/);
  assert.match(publishRoute, /Event publish blocked/);
  assert.match(publishRoute, /sent_count: sentCount/);
});

test('H-01 migration makes unlisted rows token-only and public table reads public-only', () => {
  assert.match(tokenMigration, /share_token text/i);
  assert.match(tokenMigration, /encode\(gen_random_bytes\(24\), 'base64url'\)/i);
  assert.match(tokenMigration, /where visibility = 'unlisted' and share_token is null/i);
  assert.match(tokenMigration, /visibility = 'public'/i);
  assert.doesNotMatch(tokenMigration, /visibility in \('public', 'unlisted'\)/i);
  assert.match(tokenMigration, /security definer/i);
  assert.match(tokenMigration, /get_event_by_share_token\(token text\)/i);
  assert.match(tokenMigration, /grant execute .* to anon, authenticated/i);
});

test('H-01 event page resolves a token through RPC and otherwise asks only for public rows', () => {
  assert.match(eventPage, /rpc\('get_event_by_share_token', \{ token \}\)/);
  assert.match(eventPage, /shared\?\.slug === slug/);
  assert.match(eventPage, /\.eq\('visibility', 'public'\)/);
  assert.match(eventPage, /searchParams/);
});

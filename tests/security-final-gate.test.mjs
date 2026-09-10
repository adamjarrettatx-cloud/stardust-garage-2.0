import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const migration = read('supabase/migrations/20260910000000_security_final_gate.sql');
const redeemTrialRoute = read('app/api/free-account/redeem-trial/route.js');
const availabilityRoute = read('app/api/tickets/availability/route.js');
const authHelpers = read('lib/auth-helpers.js');
const memberIdRoute = read('app/api/scan/member-id/route.js');

function functionBody(name) {
  const match = migration.match(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`,
  ));
  assert.ok(match, `expected ${name} function`);
  return match[0];
}

test('DB-01 removes broad member update and exposes only safe display fields', () => {
  assert.match(migration, /drop policy if exists "Members can update own profile" on public\.member_profiles/i);
  const body = functionBody('update_own_member_profile_display');
  assert.match(body, /if auth\.uid\(\) is null/i);
  assert.match(body, /security definer/i);
  assert.match(body, /set search_path = public/i);
  assert.match(body, /set full_name = p_display_name,[\s\S]*?phone = p_phone,[\s\S]*?notification_preferences = p_notification_preferences,[\s\S]*?profile_photo_path = p_profile_photo_path/i);
  assert.match(body, /position\('\.\.' in p_profile_photo_path\)/i);
  assert.match(body, /p_profile_photo_path like '\/%'/i);
  assert.doesNotMatch(body, /subscription_plan\s*=/i);
  assert.doesNotMatch(body, /is_active\s*=/i);
});

test('DB-02 removes free-account self-writes and keeps verification server-controlled', () => {
  assert.match(migration, /drop policy if exists free_accounts_self_insert/i);
  assert.match(migration, /drop policy if exists free_accounts_self_update/i);
  assert.match(migration, /alter column phone_verified_at drop default/i);
  const create = functionBody('create_own_free_account');
  assert.match(create, /if exists \(select 1 from public\.free_accounts where user_id = auth\.uid\(\)\)/i);
  assert.match(create, /phone_verified_at\)\s*values\s*\(auth\.uid\(\), p_full_name, p_phone, p_email, null\)/is);
  const update = functionBody('update_own_free_account_display');
  assert.match(update, /set full_name = p_full_name,[\s\S]*?email = p_email,[\s\S]*?profile_photo_path = p_profile_photo_path/i);
  assert.doesNotMatch(update, /phone_verified_at\s*=/i);
});

test('DB-03 makes public catalog policies public-event-only', () => {
  for (const policy of ['ticket_products_public_read', 'ticket_price_tiers_public_read']) {
    const start = migration.indexOf(`create policy ${policy}`);
    assert.ok(start >= 0, `expected ${policy}`);
    const end = migration.indexOf('\n\n', start);
    assert.match(migration.slice(start, end), /e\.visibility = 'public'/);
  }
});

test('DB-04 guards and limits discount redemption to service role', () => {
  const body = functionBody('increment_discount_code_redemption');
  assert.match(body, /auth\.role\(\) is distinct from 'service_role'/i);
  assert.match(migration, /revoke all on function public\.increment_discount_code_redemption\(uuid\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.increment_discount_code_redemption\(uuid\) to service_role/i);
});

test('redeeming a trial requires a verified phone and never hardcodes verification', () => {
  assert.match(redeemTrialRoute, /if \(!freeAccount\.phone_verified_at\)[\s\S]*?PHONE_NOT_VERIFIED[\s\S]*?status:\s*403/);
  assert.match(redeemTrialRoute, /phoneVerified:\s*!!freeAccount\.phone_verified_at/);
  assert.doesNotMatch(redeemTrialRoute, /phoneVerified:\s*true/);
});

test('availability hides unlisted events without their valid share token', () => {
  assert.match(availabilityRoute, /searchParams\.get\('share_token'\)/);
  assert.match(availabilityRoute, /visibility, share_token/);
  assert.match(availabilityRoute, /event\.visibility === UNLISTED_VISIBILITY[\s\S]*?event\.share_token !== shareToken[\s\S]*?status:\s*404/);
});

test('mobile team resolution carries the verified bearer token into the RLS role lookup', () => {
  assert.match(authHelpers, /const bearerToken = request[\s\S]*?parseBearerToken\(request\.headers\.get\('authorization'\)\)/);
  assert.match(authHelpers, /await getRequestUser\(request\)/);
  assert.match(authHelpers, /global: \{ headers: \{ Authorization: `Bearer \$\{bearerToken\}` \} \}/);
  assert.match(memberIdRoute, /getCurrentUser\(request\)/);
});

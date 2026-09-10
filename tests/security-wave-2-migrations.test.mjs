import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = (name) => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const photos = migration('20260911_member_photos_bucket_policies.sql');
const rpcs = migration('20260911_lockdown_definer_rpcs.sql');
const dropRaw = migration('20260911_drop_token_raw.sql');

test('member-photos becomes private with owner/team reads and owner-only traversal-safe writes', () => {
  assert.match(photos, /update storage\.buckets[\s\S]*?set public = false[\s\S]*?'member-photos'/);
  assert.match(photos, /for select to authenticated[\s\S]*?owner_id = auth\.uid\(\)(?:::\w+)? or public\.is_team\(\)/);
  assert.match(photos, /for insert to authenticated[\s\S]*?owner_id = auth\.uid\(\)(?:::\w+)?[\s\S]*?name ~ \('\^' \|\| auth\.uid\(\)::text/);
  assert.match(photos, /for update to authenticated[\s\S]*?owner_id = auth\.uid\(\)/);
  assert.match(photos, /for delete to authenticated[\s\S]*?owner_id = auth\.uid\(\)/);
  assert.doesNotMatch(photos, /to anon/);
});

test('ordinary capacity SECURITY DEFINER RPCs require an authenticated team or admin caller', () => {
  for (const fn of ['capacity_check_in', 'capacity_check_out', 'capacity_reset']) {
    const body = functionBody(rpcs, fn);
    assert.match(body, /auth\.role\(\) <> 'authenticated'/, `${fn} must reject anon/service callers`);
    assert.match(body, /not public\.is_team\(\)/, `${fn} must require team role`);
  }
  for (const fn of ['capacity_adjust', 'capacity_start_session', 'capacity_end_session']) {
    const body = functionBody(rpcs, fn);
    assert.match(body, /auth\.role\(\) <> 'authenticated'/, `${fn} must reject anon/service callers`);
    assert.match(body, /not public\.is_admin\(\)/, `${fn} must require admin role`);
  }
  assert.match(rpcs, /revoke all on function public\.capacity_adjust[\s\S]*?from public, anon, authenticated, service_role/);
  assert.match(rpcs, /grant execute on function public\.capacity_adjust\(integer, text, text\) to authenticated/);
});

test('device SECURITY DEFINER RPCs are executable only by service role after route-side token verification', () => {
  for (const fn of ['_capacity_require_device', 'capacity_device_check_in', 'capacity_device_check_out', 'capacity_device_touch']) {
    assert.match(functionBody(rpcs, fn), /auth\.role\(\) <> 'service_role'/);
  }
  assert.match(rpcs, /grant execute on function public\.capacity_device_check_in\(uuid, text\) to service_role/);
  assert.doesNotMatch(rpcs, /grant execute on function public\.capacity_device_check_in\(uuid, text\) to authenticated/);
});

test('raw member identity token column is explicitly removed', () => {
  assert.match(dropRaw, /alter table public\.member_identity_tokens drop column if exists token_raw/i);
});

test('no runtime handler, scanner, or service reads or persists token_raw', () => {
  const runtimeFiles = [
    '../lib/member-identity-token-service.mjs',
    '../app/api/member/identity-token/route.js',
    '../app/api/scan/member-id/route.js',
    '../app/member/id/page.js',
    '../app/member/id/[token]/page.js',
    '../app/member/wallet/page.jsx',
    '../app/api/admin/approve-member/route.js',
  ];
  for (const relative of runtimeFiles) {
    const src = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /token_raw/, `${relative} must use token_hash only`);
  }
});

function functionBody(sql, name) {
  const pattern = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?end; \\$\\$;`);
  const match = sql.match(pattern);
  assert.ok(match, `expected ${name} body`);
  return match[0];
}

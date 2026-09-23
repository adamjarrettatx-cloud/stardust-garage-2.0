import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('preview registry is private and launch nonces cannot be replayed', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      insert into auth.users values ('00000000-0000-4000-8000-000000000001');`);
    await db.exec(await readFile(new URL('../supabase/preview/view_portal.sql', import.meta.url), 'utf8'));
    await db.exec(`insert into view_portal_personas(persona_id,user_id) values ('free','00000000-0000-4000-8000-000000000001');
      insert into view_portal_redemptions(nonce,owner_id,persona_id) values
      ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','free');`);
    await assert.rejects(db.exec(`insert into view_portal_redemptions(nonce,owner_id,persona_id) values
      ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','free');`), /duplicate key/);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from view_portal_personas'), /permission denied/);
    await assert.rejects(db.query('select * from view_portal_redemptions'), /permission denied/);
  } finally { await db.close(); }
});

test('restricted staff roles cannot inherit the customer directory', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20260923010000_restricted_staff_profile_boundary.sql', import.meta.url),
    'utf8',
  );
  assert.match(sql, /drop policy if exists free_accounts_team_read/i);
  assert.match(sql, /using\s*\(\s*public\.is_team\(\)\s*\)/i);
  assert.doesNotMatch(sql, /from\s+public\.team_members\s+tm[\s\S]*tm\.user_id\s*=\s*auth\.uid\(\)/i);
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
      create function public.is_team() returns boolean language sql stable as
        $$ select current_setting('test.team_role') in ('team','admin') $$;
      create table public.free_accounts(user_id uuid);
      insert into public.free_accounts values
        ('00000000-0000-4000-8000-000000000001'),
        ('00000000-0000-4000-8000-000000000002');
      alter table public.free_accounts enable row level security;
      grant select on public.free_accounts to authenticated;
      grant usage on schema auth to authenticated;
      create policy self_read on public.free_accounts for select using(user_id=auth.uid());
    `);
    await db.exec(sql);
    await db.exec('set role authenticated');
    for (const [role, expected] of [['team', 2], ['admin', 2], ['front_desk', 1], ['calendar_viewer', 1]]) {
      await db.query(`select set_config('test.team_role', $1, false)`, [role]);
      const result = await db.query('select count(*)::integer as count from public.free_accounts');
      assert.equal(result.rows[0].count, expected, role);
    }
  } finally {
    await db.close();
  }
});

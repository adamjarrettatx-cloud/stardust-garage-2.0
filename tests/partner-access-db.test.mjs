import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('partner capability is additive but disabled and restricted identities have no contact scope', async () => {
  const db = new PGlite();
  const actor = '00000000-0000-4000-8000-000000000001';
  const contact = '00000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table public.partner_profiles(user_id uuid, contact_id uuid, is_active boolean);
      create table public.team_members(user_id uuid, role text);
      create table public.member_profiles(user_id uuid, is_active boolean);
      insert into partner_profiles values ('${actor}', '${contact}', true);
      insert into member_profiles values ('${actor}', true);
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20260923000000_additive_partner_access.sql', import.meta.url), 'utf8'));
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [actor]);
    const read = async () => (await db.query('select public.partner_contact_id() as id')).rows[0].id;
    assert.equal(await read(), contact);
    for (const role of ['team', 'admin', 'front_desk', 'calendar_viewer']) {
      await db.query('delete from team_members');
      await db.query('insert into team_members values ($1,$2)', [actor, role]);
      assert.equal(await read(), ['team', 'admin'].includes(role) ? contact : null);
    }
    await db.query('delete from team_members');
    await db.query('update partner_profiles set is_active=false');
    assert.equal(await read(), null);
    assert.equal((await db.query('select is_active from member_profiles')).rows[0].is_active, true);
    await db.query('update partner_profiles set is_active=true');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [contact]);
    assert.equal(await read(), null, 'another identity cannot resolve the assigned partner contact');
    const grants = (await db.query(`select
      has_function_privilege('anon','public.partner_contact_id()','EXECUTE') as anonymous,
      has_function_privilege('authenticated','public.partner_contact_id()','EXECUTE') as authenticated`)).rows[0];
    assert.deepEqual(grants, { anonymous: false, authenticated: true });
  } finally {
    await db.close();
  }
});

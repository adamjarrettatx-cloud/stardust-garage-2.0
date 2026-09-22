import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('private restriction schema, transactional audit, manager grants and identity protections', async () => {
  const db = new PGlite();
  const admin = '00000000-0000-4000-8000-000000000001';
  const desk = '00000000-0000-4000-8000-000000000002';
  const team = '00000000-0000-4000-8000-000000000003';
  const outsider = '00000000-0000-4000-8000-000000000004';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.team_members(user_id uuid primary key,role text,full_name text);
      insert into auth.users values('${admin}'),('${desk}'),('${team}'),('${outsider}');
      insert into public.team_members values('${admin}','admin','Owner'),('${desk}','front_desk','Desk'),('${team}','team','Team');`);
    await db.exec(await readFile(new URL('../supabase/migrations/20260922000000_access_restrictions.sql', import.meta.url), 'utf8'));
    const call = async (actor, action, payload) =>
      (await db.query('select public.manage_access_restriction($1,$2,$3::jsonb) as id', [actor, action, JSON.stringify(payload)])).rows[0].id;
    const input = { full_name: 'Synthetic Guest', kind: 'banned', reason: 'Test-only conduct record', match_keys: ['name:synthetic guest'], identity_keys: [] };
    const id = await call(desk, 'create', input);
    assert.ok(id);
    assert.equal((await db.query('select count(*)::int n from access_restriction_events where restriction_id=$1', [id])).rows[0].n, 1);
    await call(desk, 'note', { id, comment: 'Additional staff note' });
    await assert.rejects(call(desk, 'lift', { id, comment: 'Attempted bypass' }), /authorized managers/);
    await assert.rejects(call(team, 'lift', { id, comment: 'Team is not manager' }), /authorized managers/);
    await assert.rejects(call(outsider, 'create', input), /Not authorized/);
    await assert.rejects(call(desk, 'manager', { user_id: team, enabled: true }), /Owner/);
    // Name-only false positive can be audited and excluded for this subject.
    await call(desk, 'different_person', { id, comment: 'ID shows a different person', subject_key: 'member:test', identity_keys: ['member:test'] });
    assert.equal((await db.query('select count(*)::int n from access_restriction_exclusions')).rows[0].n, 1);
    await call(desk, 'same_person', { id, comment: 'Verified identity', subject_key: 'member:test', identity_keys: ['member:test'] });
    assert.equal((await db.query('select count(*)::int n from access_restriction_exclusions')).rows[0].n, 0);
    await assert.rejects(call(desk, 'different_person', { id, comment: 'Cannot dismiss confirmed', subject_key: 'member:test', identity_keys: ['member:test'] }), /Confirmed identity/);
    await call(admin, 'manager', { user_id: team, enabled: true });
    await call(team, 'lift', { id, comment: 'Reviewed and approved' });
    const row = (await db.query('select * from access_restrictions where id=$1', [id])).rows[0];
    assert.equal(row.lifted_by, team);
    assert.equal(row.lift_reason, 'Reviewed and approved');
    await assert.rejects(call(team, 'lift', { id, comment: 'Duplicate' }), /already lifted/);
    await call(admin, 'manager', { user_id: team, enabled: false });
    const second = await call(desk, 'create', input);
    await assert.rejects(call(team, 'lift', { id: second, comment: 'Revoked permission' }), /authorized managers/);
    await call(admin, 'lift', { id: second, comment: 'Owner review' });
    const before = (await db.query('select count(*)::int n from access_restrictions')).rows[0].n;
    await assert.rejects(call(desk, 'create', { ...input, reason: '' }));
    assert.equal((await db.query('select count(*)::int n from access_restrictions')).rows[0].n, before);
    // No public or authenticated access even if bypassing Next.js.
    const privileges = (await db.query(`select
      has_table_privilege('authenticated','public.access_restrictions','SELECT') as read,
      has_table_privilege('anon','public.access_restriction_events','SELECT') as notes,
      has_function_privilege('authenticated','public.manage_access_restriction(uuid,text,jsonb)','EXECUTE') as write`)).rows[0];
    assert.deepEqual(privileges, { read: false, notes: false, write: false });
    const policies = (await db.query("select relrowsecurity from pg_class where oid='public.access_restrictions'::regclass")).rows[0];
    assert.equal(policies.relrowsecurity, true);
  } finally { await db.close(); }
});

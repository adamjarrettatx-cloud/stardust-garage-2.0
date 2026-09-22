import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('only the three approved accounts may lift; other admins cannot lift or change grants', async () => {
  const db = new PGlite();
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.team_members(user_id uuid primary key,role text,full_name text,email text);`);
    for (const [n, name, email, role] of [
      [1,'Adam Jarrett','adam@sdgatx.com','admin'], [2,'Naish Kulpath','naish@sdgatx.com','admin'],
      [3,'Jeyu Bigelow','jeyu@sdgatx.com','admin'], [4,'Other Admin','other@example.invalid','admin'],
      [5,'Desk','desk@example.invalid','front_desk'],
    ]) {
      await db.query('insert into auth.users values($1)', [id(n)]);
      await db.query('insert into team_members values($1,$2,$3,$4)', [id(n),role,name,email]);
    }
    for (const name of ['20260922000000_access_restrictions.sql','20260922010000_restriction_lift_allowlist.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
    }
    const call = async (n, action, data) => (await db.query('select manage_access_restriction($1,$2,$3::jsonb) id', [id(n),action,JSON.stringify(data)])).rows[0].id;
    const create = () => call(5,'create',{full_name:'Synthetic Guest',kind:'banned',reason:'Test incident',identity_keys:[],match_keys:[]});
    const permissions = (await db.query('select user_id,can_manage_permissions from access_restriction_managers order by user_id')).rows;
    assert.deepEqual(permissions,[1,2,3].map(n=>({user_id:id(n),can_manage_permissions:n===1})));
    for (const n of [1,2,3]) await call(n,'lift',{id:await create(),comment:'Reviewed'});
    for (const n of [4,5]) {
      const restriction = await create();
      await call(n,'note',{id:restriction,comment:'Still allowed to add notes'});
      await assert.rejects(call(n,'lift',{id:restriction,comment:'Unauthorized'}), /authorized managers/);
    }
    for (const n of [2,3,4,5]) await assert.rejects(call(n,'manager',{user_id:id(4),enabled:true}), /Owner permission/);
    await assert.rejects(call(1,'manager',{user_id:id(1),enabled:false}), /Owner permission cannot/);
    // Owner can explicitly revoke/regrant an administrator, with audit.
    await call(1,'manager',{user_id:id(2),enabled:false});
    await assert.rejects(call(2,'lift',{id:await create(),comment:'Revoked'}), /authorized managers/);
    await call(1,'manager',{user_id:id(2),enabled:true});
    await call(2,'lift',{id:await create(),comment:'Explicitly reauthorized'});
    assert.equal((await db.query('select count(*)::int n from access_restriction_permission_events')).rows[0].n,5);
  } finally { await db.close(); }
});

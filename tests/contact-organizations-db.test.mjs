import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migration = await fs.readFile(new URL('../supabase/migrations/20260923_contact_organizations.sql',import.meta.url),'utf8');
test('organization relationship database: identity, authorization, atomic writes and history', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create table auth.users(id uuid primary key,email text,phone text,raw_user_meta_data jsonb default '{}',deleted_at timestamptz,banned_until timestamptz);
      create table public.team_members(user_id uuid,role text);
      create table public.member_profiles(id uuid primary key,user_id uuid,full_name text,created_at timestamptz default now());
      create table public.contacts(id uuid primary key default gen_random_uuid(),display_name text not null,contact_type text[] default '{}',
        entity_type text,email text,phone text,status text default 'active',created_by uuid,updated_by uuid);
      create table public.contact_audit_log(id uuid primary key default gen_random_uuid(),contact_id uuid,action text,actor_id uuid,actor_email text,details jsonb);
      insert into auth.users(id,email,raw_user_meta_data) values
        ('${id(1)}','owner@example.invalid','{"full_name":"Owner"}'),
        ('${id(2)}','member@example.invalid','{"full_name":"Member Person"}'),
        ('${id(3)}','team@example.invalid','{"full_name":"Team"}'),
        ('${id(4)}','front@example.invalid','{}'),
        ('${id(5)}','calendar@example.invalid','{}');
      insert into team_members values ('${id(1)}','admin'),('${id(3)}','team'),('${id(4)}','front_desk'),('${id(5)}','calendar_viewer');
      insert into contacts(id,display_name,contact_type,entity_type,email,status) values
        ('${id(10)}','Collective',array['collective'],null,'new@example.invalid','active'),
        ('${id(11)}','Person',array['artist'],null,'person@example.invalid','active'),
        ('${id(12)}','Individual Organizer',array['event_organizer'],'individual',null,'active'),
        ('${id(13)}','Archived',array['person'],null,'archived@example.invalid','archived'),
        ('${id(14)}','Second Organization',array['organization'],null,null,'active');
    `);
    await db.exec(migration);
    // Migration may safely re-run and must not relabel existing rows.
    await db.exec(migration);
    assert.deepEqual((await db.query(`select contact_type from contacts where id='${id(10)}'`)).rows[0].contact_type,['collective']);
    await db.exec(`set role authenticated; select set_config('test.uid','${id(1)}',false);`);
    const call = async (mode, personId=null, version=0, name=null, email=null) => (await db.query(
      `select public.set_organization_main_contact($1,$2,$3,$4,$5,null,$6) result`,
      [id(10),mode,personId,name,email,version])).rows[0].result;
    const read = async () => (await db.query('select public.get_organization_main_contact($1) result',[id(10)])).rows[0].result;
    assert.equal((await read()).version,0);
    let search=(await db.query('select * from public.search_organization_people($1)',['Person'])).rows;
    assert.ok(search.some(x=>x.source==='account' && x.id===id(2)));
    assert.ok(search.some(x=>x.source==='contact' && x.id===id(11)));
    assert.equal((await db.query('select * from public.search_organization_people($1)',['%_'])).rows.length,0);
    assert.equal((await db.query('select * from public.search_organization_people($1)',['a'])).rows.length,0);
    assert.equal((await call('contact',id(11))).person.id,id(11));
    await assert.rejects(call('account',id(2),0),/changed/);
    await assert.rejects(call('contact',id(10),1),/person contact/);
    await assert.rejects(call('contact',id(13),1),/person contact/);
    assert.equal((await call('account',id(2),1)).person.source,'account');
    // A person/account may represent multiple organizations.
    await db.query('select public.set_organization_main_contact($1,$2,$3,null,null,null,0)',[id(14),'account',id(2)]);
    await assert.rejects(call('create',null,2,'Duplicate','MEMBER@example.invalid'),/already uses/);
    const created=await call('create',null,2,'New Person','new@example.invalid');
    assert.equal(created.person.name,'New Person'); assert.equal(created.version,3);
    const newId=created.person.id;
    await assert.rejects(call('create',null,2,'New Person','new@example.invalid'),/changed/);
    assert.equal((await call('clear',null,3)).person,null);
    // Members and restricted staff must be rejected even through direct RPC.
    for(const user of [2,4,5]) {
      await db.exec(`select set_config('test.uid','${id(user)}',false);`);
      await assert.rejects(read(),/Team access required/);
      await assert.rejects(call('contact',id(11),4),/Team access required/);
      await assert.rejects(db.query("select * from public.search_organization_people('Person')"),/Team access required/);
    }
    await db.exec(`select set_config('test.uid','${id(3)}',false);`);
    assert.equal((await call('contact',id(11),4)).person.id,id(11));
    await assert.rejects(db.query("select * from public.organization_main_contacts"),/permission denied/);
    await db.exec('reset role;');
    assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,5);
    assert.equal((await db.query('select count(*)::int n from contacts where id=$1',[newId])).rows[0].n,1);
    assert.ok((await db.query('select count(*)::int n from contact_audit_log')).rows[0].n>=7);
    await assert.rejects(db.query("update contacts set profile_kind='organization' where id=$1",[id(11)]),/linked to an organization/);
    await assert.rejects(db.query("update contacts set profile_kind='person' where id=$1",[id(10)]),/Remove the main contact/);
    // Audit failure must roll back both person creation and relationship change.
    await db.exec(`alter table contact_audit_log add constraint reject_test_person check (details->>'display_name' is distinct from 'Rollback Person');
      set role authenticated; select set_config('test.uid','${id(1)}',false);`);
    await assert.rejects(call('create',null,5,'Rollback Person','rollback@example.invalid'),/reject_test_person/);
    assert.equal((await read()).version,5);
    await db.exec('reset role;');
    assert.equal((await db.query("select count(*)::int n from contacts where display_name='Rollback Person'")).rows[0].n,0);
    await db.exec('set role anon;');
    await assert.rejects(read(),/permission denied/);
  } finally { await db.close(); }
});

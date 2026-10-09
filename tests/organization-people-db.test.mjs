import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const read = (f) => fs.readFile(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8');
const base = await read('20260923_contact_organizations.sql');
const migration = await read('20261006210000_organization_people.sql');

test('organization people: linked Person profiles, auto-conversion, authorization and history', async () => {
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
        entity_type text,email text,phone text,status text default 'active',additional_contacts jsonb not null default '[]',
        created_by uuid,updated_by uuid,created_at timestamptz not null default now());
      grant select,insert,update on public.contacts to authenticated;
      create table public.contact_audit_log(id uuid primary key default gen_random_uuid(),contact_id uuid,action text,actor_id uuid,actor_email text,details jsonb);
      insert into auth.users(id,email,raw_user_meta_data) values
        ('${id(1)}','owner@example.invalid','{"full_name":"Owner"}'),
        ('${id(2)}','member@example.invalid','{"full_name":"Member Person"}'),
        ('${id(3)}','team@example.invalid','{}'),('${id(4)}','front@example.invalid','{}');
      insert into team_members values ('${id(1)}','admin'),('${id(3)}','team'),('${id(4)}','front_desk');
      insert into contacts(id,display_name,contact_type,email,status,additional_contacts) values
        ('${id(10)}','Scissor Sisters ATX',array['organization'],'atx.ss@example.invalid','active',
          '[{"name":"Aeerie Kairuz","role":"Founder","email":"ATX.SS@example.invalid","phone":""},{"name":"","role":"","email":"","phone":""},{"name":"","email":"booker@example.invalid","role":"Booker"}]'),
        ('${id(11)}','Existing Person',array['artist'],'existing@example.invalid','active','[]'),
        ('${id(12)}','Solo DJ',array['dj'],null,'active','[{"name":"Manager","role":"Manager"}]'),
        ('${id(13)}','Archived Person',array['person'],null,'archived','[]'),
        ('${id(14)}','Archived Org',array['organization'],null,'archived','[]');
    `);
    await db.exec(base);
    await db.exec(migration);
    // Existing organization entries were converted into linked Person profiles.
    let rows = (await db.query(`select c.display_name,c.email,c.profile_kind,c.contact_type,p.role from organization_people p
      join contacts c on c.id=p.person_contact_id where p.organization_id=$1 order by c.display_name`,[id(10)])).rows;
    assert.deepEqual(rows.map(r=>[r.display_name,r.email,r.profile_kind,r.role]),
      [['Aeerie Kairuz','atx.ss@example.invalid','person','Founder'],['booker@example.invalid','booker@example.invalid','person','Booker']]);
    assert.deepEqual((await db.query(`select additional_contacts from contacts where id=$1`,[id(10)])).rows[0].additional_contacts,[]);
    assert.ok((await db.query(`select 1 from contact_audit_log where contact_id=$1 and details ? 'converted_additional_contacts'`,[id(10)])).rows.length);
    // Person profiles keep their free-text additional contacts.
    assert.equal((await db.query(`select jsonb_array_length(additional_contacts) n from contacts where id=$1`,[id(12)])).rows[0].n,1);
    // Re-running the migration is safe and creates no duplicates.
    await db.exec(migration);
    assert.equal((await db.query(`select count(*)::int n from organization_people`)).rows[0].n,2);

    await db.exec(`set role authenticated; select set_config('test.uid','${id(1)}',false);`);
    // Browser-style saves of an organization with free-text entries convert automatically,
    // reusing an exact name+email match instead of duplicating it.
    await db.query(`update contacts set additional_contacts='[{"name":"aeerie kairuz","email":"atx.ss@example.invalid","role":"Co-founder"},{"name":"New Helper","role":"Door"}]' where id=$1`,[id(10)]);
    rows = (await db.query(`select * from public.get_organization_people($1) r`,[id(10)])).rows[0].r;
    assert.equal(rows.length,3);
    assert.equal(rows.find(r=>r.name==='Aeerie Kairuz').role,'Co-founder');
    assert.ok(rows.some(r=>r.name==='New Helper' && r.role==='Door'));
    const created = (await db.query(`insert into contacts(display_name,contact_type,profile_kind,additional_contacts)
      values('New Collective',array['collective'],'organization','[{"name":"Insert Person","role":"Lead"}]') returning id`)).rows[0].id;
    assert.equal((await db.query(`select * from public.get_organization_people($1) r`,[created])).rows[0].r[0].name,'Insert Person');

    const add = (mode, personId, name=null, email=null, role=null, org=id(10)) => db.query(
      `select public.add_organization_person($1,$2,$3,$4,$5,null,$6) r`,[org,mode,personId,name,email,role]).then(r=>r.rows[0].r);
    let people = await add('contact',id(11),null,null,'Resident');
    assert.ok(people.some(p=>p.id===id(11) && p.role==='Resident'));
    await assert.rejects(add('contact',id(11)),/already linked/);
    await assert.rejects(add('contact',id(13)),/non-archived person/);
    await assert.rejects(add('contact',id(10)),/non-archived person/);
    await assert.rejects(add('contact',id(11),null,null,null,id(14)),/Restore the organization/);
    await assert.rejects(add('create',null,'Bad','not-an-email'),/valid name/);
    // An account becomes (or reuses) a person profile; the account is untouched.
    people = await add('account',id(2),null,null,'Promoter');
    const fromAccount = people.find(p=>p.name==='Member Person');
    assert.equal(fromAccount.email,'member@example.invalid');
    people = await add('create',null,'Fresh Person','fresh@example.invalid','Booker');
    const fresh = people.find(p=>p.name==='Fresh Person');
    // Same person can belong to several organizations; person profile lists them.
    await add('contact',fresh.id,null,null,'Advisor',created);
    await db.query(`select public.set_organization_main_contact($1,'contact',$2,null,null,null,0)`,[created,fresh.id]);
    const orgs = (await db.query(`select public.get_person_organizations($1) r`,[fresh.id])).rows[0].r;
    assert.deepEqual(orgs.map(o=>[o.name,o.role,o.main_contact]),[['New Collective','Advisor',true],['Scissor Sisters ATX','Booker',false]]);
    // Role edit and removal keep the person profile.
    people = (await db.query(`select public.update_organization_person($1,'Head booker') r`,[fresh.link_id])).rows[0].r;
    assert.equal(people.find(p=>p.id===fresh.id).role,'Head booker');
    people = (await db.query(`select public.remove_organization_person($1) r`,[fresh.link_id])).rows[0].r;
    assert.ok(!people.some(p=>p.id===fresh.id));
    await assert.rejects(db.query(`select public.remove_organization_person($1)`,[fresh.link_id]),/no longer linked/);
    // Linked people block changing an organization into a person and vice versa.
    await assert.rejects(db.query(`update contacts set profile_kind='person' where id=$1`,[id(10)]),/linked people/);
    await assert.rejects(db.query(`update contacts set profile_kind='organization' where id=$1`,[id(11)]),/linked to an organization/);
    // Restricted staff and members are rejected even through direct RPC; table is not readable.
    for (const user of [2,4]) {
      await db.exec(`select set_config('test.uid','${id(user)}',false);`);
      await assert.rejects(db.query(`select public.get_organization_people($1)`,[id(10)]),/Team access required/);
      await assert.rejects(add('create',null,'Sneaky'),/Team access required/);
      await assert.rejects(db.query(`select public.get_person_organizations($1)`,[id(11)]),/Team access required/);
    }
    await db.exec(`select set_config('test.uid','${id(3)}',false);`);
    await assert.rejects(db.query(`select * from public.organization_people`),/permission denied/);
    await assert.rejects(db.query(`select public._link_organization_person($1,'x',null,null,null,'x')`,[id(10)]),/permission denied/);
    assert.ok((await add('create',null,'Team Added')).some(p=>p.name==='Team Added'));
    await db.exec('reset role;');
    assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,4);
    assert.ok((await db.query(`select count(*)::int n from contact_audit_log where action in ('link_added','link_removed')`)).rows[0].n>=10);
  } finally { await db.close(); }
});

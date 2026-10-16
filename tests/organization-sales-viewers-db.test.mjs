import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const read = (f) => fs.readFile(new URL(`../supabase/migrations/${f}`, import.meta.url), 'utf8');

test('event sales viewers: per-person toggle grants My Events only, admin-only and audited', async () => {
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
      create table public.partner_profiles(id uuid primary key default gen_random_uuid(),user_id uuid unique,contact_id uuid unique,full_name text,
        photo_url text,is_active boolean default false,invited_at timestamptz,activated_at timestamptz);
      create table public.events(id uuid primary key,contact_id uuid,title text); grant select on public.events to authenticated;
      create table public.event_guestlist_grants(id uuid,event_id uuid,contact_id uuid);
      create table public.event_bookings(id uuid,event_id uuid,contact_id uuid,status text);
      create table public.document_contracts(id uuid,event_id uuid,contact_id uuid,collective_contact_id uuid,status text);
      create function public.partner_contact_id() returns uuid language sql stable security definer set search_path='' as
        $$ select contact_id from public.partner_profiles where user_id=auth.uid() and is_active limit 1 $$;
      insert into auth.users(id,email) values ('${id(1)}','owner@example.invalid'),('${id(3)}','team@example.invalid'),
        ('${id(5)}','viewer@example.invalid'),('${id(6)}','other@example.invalid'),('${id(7)}','pending@example.invalid'),('${id(8)}','desk@example.invalid'),
        ('${id(9)}','main@example.invalid'),('${id(4)}','org@example.invalid');
      insert into team_members values ('${id(1)}','admin'),('${id(3)}','team'),('${id(8)}','front_desk');
      insert into contacts(id,display_name,contact_type,status) values
        ('${id(10)}','Scissor Sisters ATX',array['event_organizer'],'active'),
        ('${id(11)}','Other Org',array['organization'],'active'),
        ('${id(20)}','Viewer Person',array['person'],'active'),
        ('${id(21)}','Linked No Access',array['person'],'active'),
        ('${id(22)}','Pending Person',array['person'],'active'),
        ('${id(23)}','Desk Person',array['person'],'active'),
        ('${id(24)}','Main Person',array['person'],'active');
      insert into events values ('${id(100)}','${id(10)}','BODY HORROR'),('${id(101)}','${id(11)}','Not Theirs');
      insert into partner_profiles(user_id,contact_id,is_active,activated_at) values
        ('${id(5)}','${id(20)}',true,now()),('${id(6)}','${id(21)}',true,now()),('${id(8)}','${id(23)}',true,now()),
        ('${id(9)}','${id(24)}',true,now()),('${id(4)}','${id(10)}',true,now());
      insert into partner_profiles(user_id,contact_id,is_active,invited_at) values ('${id(7)}','${id(22)}',false,now());
    `);
    for (const f of ['20260923_contact_organizations.sql', '20261006210000_organization_people.sql',
      '20261013200000_organization_main_contact_events.sql', '20261015230000_organization_sales_viewers.sql',
      '20261015235000_writeup_organizer_main_contact_only.sql']) {
      await db.exec(await read(f));
    }
    await db.exec(`insert into organization_people(organization_id,person_contact_id,role) values
      ('${id(10)}','${id(20)}','Booker'),('${id(10)}','${id(21)}','Door'),('${id(10)}','${id(22)}','Promo'),('${id(10)}','${id(23)}','Desk')`);
    const as = (uid) => db.exec(`reset role; set role authenticated; select set_config('test.uid','${uid}',false);`);
    const events = async (uid) => { await as(uid);
      return (await db.query(`select e.title from events e where public.partner_has_event(e.id) order by 1`)).rows.map((r) => r.title); };
    const link = async (personN) => { await db.exec('reset role');
      return (await db.query(`select id from organization_people where person_contact_id=$1`, [id(personN)])).rows[0].id; };

    // Default: linked people see nothing.
    assert.deepEqual(await events(id(5)), []);
    await as(id(5));
    assert.equal((await db.query(`select manages_event_organization m from partner_self()`)).rows[0].m, false);

    // Team (non-admin) can read the list but cannot grant access.
    const viewerLink = await link(20);
    await as(id(3));
    let people = (await db.query(`select get_organization_people($1) r`, [id(10)])).rows[0].r;
    assert.deepEqual(people.map((p) => [p.name, p.can_view_event_sales, p.portal]).sort(),
      [['Desk Person', false, 'active'], ['Linked No Access', false, 'active'], ['Pending Person', false, 'invited'], ['Viewer Person', false, 'active']]);
    await assert.rejects(db.query(`select set_organization_person_sales_access($1,true)`, [viewerLink]), /Only an admin/);

    // Admin turns it on for two people; each sees only this organization's events.
    await as(id(1));
    await db.query(`select set_organization_person_sales_access($1,true)`, [viewerLink]);
    const pendingLink = await link(22); const deskLink = await link(23);
    await as(id(1));
    await db.query(`select set_organization_person_sales_access($1,true)`, [pendingLink]);
    await db.query(`select set_organization_person_sales_access($1,true)`, [deskLink]);
    assert.deepEqual(await events(id(5)), ['BODY HORROR']);
    await as(id(5));
    assert.equal((await db.query(`select manages_event_organization m from partner_self()`)).rows[0].m, true);
    assert.equal((await db.query(`select partner_has_capability('events') v`)).rows[0].v, true);
    // Sales access does not unlock guest list, pay or contracts for a Person.
    assert.equal((await db.query(`select partner_has_capability('guestList') v`)).rows[0].v, false);
    assert.equal((await db.query(`select partner_has_capability('contracts') v`)).rows[0].v, false);
    // Sales access never extends to the Financial Write-Up.
    assert.equal((await db.query(`select partner_is_event_organizer($1) v`, [id(100)])).rows[0].v, false);
    // Untoggled linked person, pending invite and restricted station stay blocked.
    assert.deepEqual(await events(id(6)), []);
    assert.deepEqual(await events(id(7)), []);
    assert.deepEqual(await events(id(8)), []);

    // Write-Ups: the organizer login and the main contact only.
    await db.exec(`reset role; insert into organization_main_contacts(organization_id,person_contact_id,updated_by) values ('${id(10)}','${id(24)}','${id(1)}')`);
    const isOrganizer = async (uid, ev) => { await as(uid);
      return (await db.query(`select partner_is_event_organizer($1) v`, [ev])).rows[0].v; };
    assert.equal(await isOrganizer(id(4), id(100)), true);
    assert.equal(await isOrganizer(id(9), id(100)), true);
    assert.equal(await isOrganizer(id(9), id(101)), false);
    assert.equal(await isOrganizer(id(5), id(100)), false);
    assert.equal(await isOrganizer(id(7), id(100)), false);
    assert.equal(await isOrganizer(id(8), id(100)), false);
    await db.exec(`reset role; update contacts set status='archived' where id='${id(10)}'`);
    assert.equal(await isOrganizer(id(9), id(100)), false);
    await db.exec(`reset role; update contacts set status='active' where id='${id(10)}'`);

    // Audit history on both profiles.
    await db.exec('reset role');
    assert.equal((await db.query(`select count(*)::int n from contact_audit_log where details->'changed' ? 'event_sales_access'`)).rows[0].n, 6);

    // Archiving the organization, turning access off, or unlinking removes it.
    await db.exec(`update contacts set status='archived' where id='${id(10)}'`);
    assert.deepEqual(await events(id(5)), []);
    await db.exec(`reset role; update contacts set status='active' where id='${id(10)}'`);
    assert.deepEqual(await events(id(5)), ['BODY HORROR']);
    await as(id(1));
    await db.query(`select set_organization_person_sales_access($1,false)`, [viewerLink]);
    assert.deepEqual(await events(id(5)), []);
    await as(id(1));
    await db.query(`select set_organization_person_sales_access($1,true)`, [viewerLink]);
    await db.query(`select remove_organization_person($1)`, [viewerLink]);
    assert.deepEqual(await events(id(5)), []);

    // Anonymous callers cannot reach the setter.
    await db.exec(`reset role; set role anon;`);
    await assert.rejects(db.query(`select set_organization_person_sales_access($1,true)`, [await (async () => { await db.exec('reset role'); const r = (await db.query(`select id from organization_people limit 1`)).rows[0].id; await db.exec('set role anon'); return r; })()]));
  } finally { await db.close(); }
});

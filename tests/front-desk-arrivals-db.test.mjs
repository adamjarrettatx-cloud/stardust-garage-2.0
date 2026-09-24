import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const migration = await readFile(new URL('../supabase/migrations/20260924170000_front_desk_arrivals.sql', import.meta.url), 'utf8');
const actor = '00000000-0000-4000-8000-000000000001';
const guest = '00000000-0000-4000-8000-000000000002';
const member = '00000000-0000-4000-8000-000000000003';
const db = new PGlite();
test('atomic arrival ledger: permissions, dedupe, audit, capacity rollback and shift boundaries', async () => {
  try {
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('${actor}');
      create table public.team_members(user_id uuid,role text);
      insert into public.team_members values ('${actor}','front_desk');
      create table public.door_sessions(id uuid primary key,event_id uuid,closed_at timestamptz,opened_at timestamptz);
      create table public.capacity_sessions(id uuid primary key default gen_random_uuid(),current_count integer,max_capacity integer,is_active boolean,started_at timestamptz default now());
      insert into public.capacity_sessions(current_count,max_capacity,is_active) values(0,2,true);
      create table public.capacity_events(id uuid default gen_random_uuid(),session_id uuid,action text,delta integer,count_after integer,max_capacity integer,actor_id uuid,source text,note text);
      create function public._capacity_lock_active() returns public.capacity_sessions language plpgsql as $$
      declare s public.capacity_sessions; begin
        select * into s from public.capacity_sessions where is_active for update;
        if not found then raise exception 'No active capacity session'; end if; return s;
      end $$;
    `);
    await db.exec(migration);
    const call = (kind, id, keys, user = actor) => db.query(
      'select public.front_desk_roster_check_in($1,$2,$3,$4,null) as result', [kind,id,keys,user]);
    const first = (await call('guest', guest, [`guest:${guest}`,`user:${guest}`])).rows[0].result;
    assert.equal(first.alreadyCheckedIn, false);
    const retry = (await call('guest', guest, [`guest:${guest}`,`user:${guest}`])).rows[0].result;
    assert.equal(retry.alreadyCheckedIn, true);
    assert.equal(retry.arrival.checked_in_at, first.arrival.checked_in_at);
    const linked = (await call('member', member, [`member:${member}`,`user:${guest}`])).rows[0].result;
    assert.equal(linked.alreadyCheckedIn, true);
    assert.equal((await db.query('select current_count from capacity_sessions')).rows[0].current_count, 1);
    assert.equal((await db.query('select count(*)::int n from capacity_events')).rows[0].n, 1);
    assert.equal((await db.query('select checked_in_by from front_desk_arrivals')).rows[0].checked_in_by, actor);
    await assert.rejects(call('guest', member, [`guest:${member}`], guest), /Not authorized/);
    await assert.rejects(call('guest', member, []), /Invalid identity/);
    await call('guest', member, [`guest:${member}`]);
    const third = '00000000-0000-4000-8000-000000000004';
    await assert.rejects(call('guest', third, [`guest:${third}`]), /At capacity/);
    assert.equal((await db.query('select count(*)::int n from front_desk_arrivals')).rows[0].n, 2);
    assert.equal((await db.query('select current_count from capacity_sessions')).rows[0].current_count, 2);
    await db.exec(`update capacity_sessions set is_active=false`);
    await assert.rejects(call('guest', third, [`guest:${third}`]), /No active capacity session/);
    const acl = (await db.query(`select
      has_function_privilege('authenticated','public.front_desk_roster_check_in(text,uuid,text[],uuid,uuid)','execute') as staff,
      has_function_privilege('anon','public.front_desk_roster_check_in(text,uuid,text[],uuid,uuid)','execute') as anon,
      has_function_privilege('service_role','public.front_desk_roster_check_in(text,uuid,text[],uuid,uuid)','execute') as server,
      has_table_privilege('authenticated','front_desk_arrivals','select') as direct_read`)).rows[0];
    assert.deepEqual(acl, { staff:false, anon:false, server:true, direct_read:false });
    const before = (await db.query(`select (('2026-09-25 10:59:59+00'::timestamptz at time zone 'America/Chicago') - interval '6 hours')::date::text as shift_day`)).rows[0].shift_day;
    const after = (await db.query(`select (('2026-09-25 11:00:00+00'::timestamptz at time zone 'America/Chicago') - interval '6 hours')::date::text as shift_day`)).rows[0].shift_day;
    assert.equal(before,'2026-09-24'); assert.equal(after,'2026-09-25');
  } finally { await db.close(); }
});

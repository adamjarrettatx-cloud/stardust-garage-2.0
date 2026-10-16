import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Roster ("Tonight Sign-ins") check-in must redeem the guest's own account
// ticket for the running event, exactly like a pass scan does.
const base = await readFile(new URL('../supabase/migrations/20260924170000_front_desk_arrivals.sql', import.meta.url), 'utf8');
const fix = await readFile(new URL('../supabase/migrations/20261010150000_roster_checkin_redeems_ticket.sql', import.meta.url), 'utf8');
const actor = '00000000-0000-4000-8000-000000000001';
const buyer = '00000000-0000-4000-8000-0000000000b1';
const walkup = '00000000-0000-4000-8000-0000000000b2';
const emailBuyer = '00000000-0000-4000-8000-0000000000b3';
const pass1 = '00000000-0000-4000-8000-0000000000c1';
const pass2 = '00000000-0000-4000-8000-0000000000c2';
const pass3 = '00000000-0000-4000-8000-0000000000c3';
const pass4 = '00000000-0000-4000-8000-0000000000c4';
const event = '00000000-0000-4000-8000-0000000000e1';
const otherEvent = '00000000-0000-4000-8000-0000000000e2';
const session = '00000000-0000-4000-8000-0000000000d1';

test('roster check-in redeems the account ticket, once, and falls back without one', async () => {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    insert into auth.users values ('${actor}','staff@x',now()),('${buyer}','buyer@x',now()),
      ('${walkup}','walk@x',now()),('${emailBuyer}','Pre@X',now());
    create table public.team_members(user_id uuid,role text);
    insert into public.team_members values ('${actor}','front_desk');
    create table public.station_accounts(user_id uuid, role text, active boolean, reset_started_at timestamptz);
    create table public.member_profiles(id uuid primary key, user_id uuid);
    create table public.door_sessions(id uuid primary key,event_id uuid,closed_at timestamptz,opened_at timestamptz);
    insert into public.door_sessions values ('${session}','${event}',null,now());
    create table public.capacity_sessions(id uuid primary key default gen_random_uuid(),current_count integer,max_capacity integer,is_active boolean,started_at timestamptz default now());
    insert into public.capacity_sessions(current_count,max_capacity,is_active) values(0,10,true);
    create table public.capacity_events(id uuid default gen_random_uuid(),session_id uuid,action text,delta integer,count_after integer,max_capacity integer,actor_id uuid,source text,note text);
    create function public._capacity_lock_active() returns public.capacity_sessions language plpgsql as $$
    declare s public.capacity_sessions; begin
      select * into s from public.capacity_sessions where is_active for update;
      if not found then raise exception 'No active capacity session'; end if; return s;
    end $$;
    create table public.ticket_products(id uuid primary key, name text);
    insert into public.ticket_products values ('00000000-0000-4000-8000-0000000000f1','Early Bird');
    create table public.orders(id uuid primary key, event_id uuid, user_id uuid, member_profile_id uuid, buyer_email text, status text);
    create table public.tickets(id uuid primary key default gen_random_uuid(), order_id uuid, event_id uuid, product_id uuid,
      ticket_code text, status text, used_at timestamptz, reserved_for_guest boolean default false, created_at timestamptz default clock_timestamp());
    create table public.ticket_checkins(id uuid default gen_random_uuid(), ticket_id uuid, event_id uuid, ticket_code_attempted text,
      result text, scanned_by uuid, door_session_id uuid, note text);
    -- buyer: two tickets tonight (one reserved for a guest) + one for another event
    insert into public.orders values ('00000000-0000-4000-8000-0000000000a1','${event}','${buyer}',null,'buyer@x','paid'),
      ('00000000-0000-4000-8000-0000000000a2','${otherEvent}','${buyer}',null,'buyer@x','paid'),
      ('00000000-0000-4000-8000-0000000000a3','${event}',null,null,' pre@x ','paid'),
      ('00000000-0000-4000-8000-0000000000a4','${event}','${walkup}',null,'walk@x','refunded');
    insert into public.tickets(order_id,event_id,product_id,ticket_code,status,reserved_for_guest) values
      ('00000000-0000-4000-8000-0000000000a1','${event}','00000000-0000-4000-8000-0000000000f1','AAA','valid',false),
      ('00000000-0000-4000-8000-0000000000a1','${event}','00000000-0000-4000-8000-0000000000f1','BBB','valid',true),
      ('00000000-0000-4000-8000-0000000000a2','${otherEvent}',null,'CCC','valid',false),
      ('00000000-0000-4000-8000-0000000000a3','${event}',null,'DDD','valid',false),
      ('00000000-0000-4000-8000-0000000000a4','${event}',null,'EEE','valid',false);
  `);
  await db.exec(base);
  await db.exec(fix);
  const call = (id, keys) => db.query(
    'select public.front_desk_roster_check_in($1,$2,$3,$4,$5) as r',
    ['trial_pass', id, keys, actor, session]).then(r => r.rows[0].r);
  const status = code => db.query('select status from public.tickets where ticket_code=$1', [code]).then(r => r.rows[0].status);

  // Ticket buyer checked in by name → their own unreserved ticket is used.
  const first = await call(pass1, [`trial_pass:${pass1}`, `user:${buyer}`]);
  assert.equal(first.alreadyCheckedIn, false);
  assert.equal(first.ticket.product_label, 'Early Bird');
  assert.equal(await status('AAA'), 'used');
  assert.equal(await status('BBB'), 'valid', 'guest-reserved ticket is never auto-used');
  assert.equal(await status('CCC'), 'valid', 'other event untouched');
  const audit = await db.query("select result, note from public.ticket_checkins");
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].result, 'valid');
  assert.match(audit.rows[0].note, /^roster:/);

  // Repeat tap: no second ticket, no capacity bump.
  const again = await call(pass1, [`trial_pass:${pass1}`, `user:${buyer}`]);
  assert.equal(again.alreadyCheckedIn, true);
  assert.equal(await status('BBB'), 'valid');

  // Pre-login purchase matched by verified account email (case/space-insensitive).
  const viaEmail = await call(pass3, [`trial_pass:${pass3}`, `user:${emailBuyer}`]);
  assert.ok(viaEmail.ticket);
  assert.equal(await status('DDD'), 'used');

  // Refunded order is not admission; walk-up without a ticket still checks in.
  const walk = await call(pass2, [`trial_pass:${pass2}`, `user:${walkup}`]);
  assert.equal(walk.alreadyCheckedIn, false);
  assert.equal(walk.ticket, null);
  assert.equal(await status('EEE'), 'valid');

  // Guest without any account key → no ticket lookup, still admitted.
  const anon = await call(pass4, [`trial_pass:${pass4}`]);
  assert.equal(anon.ticket, null);

  const cap = await db.query('select current_count from public.capacity_sessions');
  assert.equal(cap.rows[0].current_count, 4);
  await db.close();
});

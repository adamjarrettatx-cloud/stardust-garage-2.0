import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture() {
  const db=new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create table team_members(id uuid primary key,user_id uuid,role text);
      create table test_station_sessions(hash text,user_id uuid,role text,active boolean);
      create function resolve_station_session(p_hash text) returns table(user_id uuid,role text)
        language sql as $$select user_id,role from test_station_sessions where hash=p_hash and active$$;
      create table capacity_device_tokens(id uuid primary key,device_role text,active boolean,revoked_at timestamptz);
      create table events(id uuid primary key,status text,is_weekend_music_experience boolean);
      create table door_sessions(id uuid primary key,event_id uuid,closed_at timestamptz);
      create table member_profiles(id uuid primary key,user_id uuid,is_active boolean,subscription_status text,profile_photo_path text,photo_url text);
      create table member_identity_tokens(member_profile_id uuid,token_hash text,revoked_at timestamptz);
      create table trial_passes(id uuid primary key,user_id uuid,member_profile_id uuid,qr_token_hash text,status text,
        activated_at timestamptz,signup_expires_at timestamptz,expires_at timestamptz,extended_until timestamptz,profile_photo_path text,updated_at timestamptz);
      create table orders(id uuid primary key,event_id uuid,user_id uuid,member_profile_id uuid,buyer_email text,status text);
      create table tickets(id uuid primary key,event_id uuid,order_id uuid,created_at timestamptz default now(),ticket_code text,status text,used_at timestamptz);
      create table ticket_audit_log(event_id uuid,order_id uuid,ticket_id uuid,actor_user_id uuid,actor_role text,action text,detail jsonb);
      create table ticket_checkins(id uuid primary key default gen_random_uuid(),ticket_id uuid,event_id uuid,ticket_code_attempted text,result text,scanned_by uuid,door_session_id uuid,note text);
      create table member_id_scans(id uuid primary key default gen_random_uuid(),member_profile_id uuid,event_id uuid,result text,scanned_by uuid,door_session_id uuid);
      create table trial_pass_checkins(id uuid primary key default gen_random_uuid(),trial_pass_id uuid,event_id uuid,result text,
        checked_in_by uuid references team_members(id),door_device_id uuid,door_session_id uuid);
      create unique index trial_once on trial_pass_checkins(trial_pass_id,event_id) where result='allowed';
      create table capacity_sessions(id uuid primary key,is_active boolean,current_count int,max_capacity int,updated_at timestamptz);
      create table capacity_events(id uuid primary key default gen_random_uuid(),session_id uuid,action text,delta int,count_after int,max_capacity int,actor_id uuid,source text,note text);
      create table front_desk_arrivals(subject_kind text,subject_id uuid,identity_keys text[],shift_day date,
        checked_in_by uuid,capacity_session_id uuid,door_session_id uuid,unique(shift_day,subject_kind,subject_id));
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261002010500_guest_ticket_reservation.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/20261002011000_atomic_door_admission.sql',import.meta.url),'utf8'));
    await db.exec(`
      insert into team_members values('${id(1)}','${id(2)}','front_desk'),('${id(3)}','${id(4)}','calendar_viewer');
      insert into auth.users values('${id(10)}','owner@example.invalid',now()),('${id(11)}','guest@example.invalid',now()),('${id(12)}','trial@example.invalid',now());
      insert into events values('${id(20)}','published',true),('${id(21)}','published',true);
      insert into door_sessions values('${id(22)}','${id(20)}',null);
      insert into capacity_sessions values('${id(23)}',true,0,100,now());
      insert into member_profiles values('${id(30)}','${id(10)}',true,'active','${id(10)}/photo.jpg',null),
        ('${id(31)}','${id(11)}',true,'active','${id(11)}/photo.jpg',null);
      insert into member_identity_tokens values('${id(30)}','hash',null),('${id(31)}','guest-hash',null);
      insert into trial_passes values('${id(32)}','${id(12)}',null,'trial-hash','active',null,now()+interval '30 days',now()+interval '30 days',null,'trial.jpg',now());
      insert into orders values('${id(40)}','${id(20)}','${id(10)}','${id(30)}','owner@example.invalid','paid'),
        ('${id(41)}','${id(21)}','${id(10)}','${id(30)}','owner@example.invalid','paid');
      insert into tickets(id,event_id,order_id,ticket_code,status) values
        ('${id(50)}','${id(20)}','${id(40)}','FIRST','valid'),
        ('${id(51)}','${id(20)}','${id(40)}','GROUP','valid'),
        ('${id(52)}','${id(20)}','${id(40)}','TRIAL','valid'),
        ('${id(53)}','${id(21)}','${id(41)}','WRONG','valid');
    `);
    const run=async(overrides={})=>{
      const p={actor:id(2),device:null,kind:'member',subject:id(30),hash:'hash',event:id(20),session:id(22),code:null,station:null,...overrides};
      return (await db.query('select commit_door_admission($1,$2,$3,$4,$5,$6,$7,$8,$9) result',
        [p.actor,p.device,p.kind,p.subject,p.hash,p.event,p.session,p.code,p.station])).rows[0].result;
    };
    const reserve=async(ticket=50, reserved=true, actor=10, expected=!reserved)=>
      (await db.query('select set_ticket_guest_reservation($1,$2,$3,$4) result',
        [id(actor),id(ticket),reserved,expected])).rows[0].result;
    return {db,run,reserve};
  } catch(error) { await db.close(); throw error; }
}
test('admission transaction enforces identity, ticket, event, capacity, roles, retry safety and rollback', async () => {
  const {db,run}=await fixture();
  try {
    await assert.rejects(run({actor:id(4)}),/authorization/);
    await db.exec(`insert into test_station_sessions values('station-hash','${id(6)}','front_desk',true),
      ('calendar-hash','${id(7)}','calendar_viewer',true)`);
    await assert.rejects(run({actor:id(6),station:'forged'}),/authorization/);
    await assert.rejects(run({actor:id(7),station:'calendar-hash'}),/authorization/);
    await assert.rejects(run({event:null}),/correct door event/);
    await assert.rejects(run({event:id(21)}),/correct door event/);
    await assert.rejects(run({session:id(99)}),/correct door event/);
    await assert.rejects(run({hash:'forged'}),/no longer valid/);
    await db.exec(`update member_profiles set is_active=false where id='${id(30)}'`);
    await assert.rejects(run(),/not active/);
    await db.exec(`update member_profiles set is_active=true,subscription_status='past_due' where id='${id(30)}'`);
    await assert.rejects(run(),/not active/);
    await db.exec(`update member_profiles set subscription_status='active',profile_photo_path=null where id='${id(30)}'`);
    await assert.rejects(run(),/photo required/);
    await db.exec(`update member_profiles set profile_photo_path='own.jpg' where id='${id(30)}'`);
    await assert.rejects(run({code:'WRONG'}),/valid unused ticket/);
    await assert.rejects(run({code:'MISSING'}),/valid unused ticket/);
    await db.exec(`update orders set status='refunded' where id='${id(40)}'`);
    await assert.rejects(run(),/valid unused ticket/);
    await db.exec(`update orders set status='paid';update capacity_sessions set current_count=100`);
    await assert.rejects(run(),/capacity/);
    await db.exec(`update capacity_sessions set current_count=0`);
    // A late failure must restore ticket, audit rows, activation and capacity.
    await db.exec(`alter table capacity_events add constraint deliberate_failure check(delta<0)`);
    await assert.rejects(run());
    assert.equal((await db.query(`select count(*)::int n from tickets where status='used'`)).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from door_admissions')).rows[0].n,0);
    await db.exec('alter table capacity_events drop constraint deliberate_failure');
    const first=await run();
    assert.equal(first.ok,true);
    assert.equal(first.ticket.ticket_id,id(50));
    assert.equal((await run()).result,'already_used');
    assert.equal((await db.query(`select status from tickets where id='${id(51)}'`)).rows[0].status,'valid');
    // A friend cannot consume buyer tickets by pass alone; staff must pair the QR.
    const guest={subject:id(31),hash:'guest-hash'};
    await assert.rejects(run(guest),/valid unused ticket/);
    assert.equal((await run({...guest,code:'GROUP',actor:id(6),station:'station-hash'})).ok,true);
    await db.exec(`update test_station_sessions set active=false where hash='station-hash'`);
    await assert.rejects(run({...guest,actor:id(6),station:'station-hash'}),/authorization/);
    assert.equal((await run({...guest,code:'TRIAL'})).result,'already_used');
    // Trial activation and staff FK are committed together.
    const trial={kind:'trial_pass',subject:id(32),hash:'trial-hash',code:'TRIAL'};
    await db.exec(`update events set is_weekend_music_experience=false where id='${id(20)}'`);
    await assert.rejects(run(trial),/does not accept trial/);
    await db.exec(`update events set is_weekend_music_experience=true`);
    assert.equal((await run(trial)).ok,true);
    assert.equal((await run(trial)).result,'already_used');
    assert.equal((await db.query('select current_count from capacity_sessions')).rows[0].current_count,3);
    assert.equal((await db.query('select checked_in_by from trial_pass_checkins')).rows[0].checked_in_by,id(1));
    assert.ok((await db.query('select activated_at from trial_passes')).rows[0].activated_at);
    const grant=(await db.query(`select has_function_privilege('authenticated',
      'commit_door_admission(uuid,uuid,text,uuid,text,uuid,uuid,text,text)','EXECUTE') allowed`)).rows[0];
    assert.equal(grant.allowed,false);
  } finally {await db.close();}
});

test('guest screenshot sent BEFORE buyer entry stays usable when buyer arrives first', async()=>{
  const {db,run,reserve}=await fixture();
  try {
    // Reserve the oldest ticket specifically: without the new filter the buyer consumes it.
    assert.equal((await reserve()).reserved_for_guest,true);
    assert.equal((await reserve()).reserved_for_guest,true); // safe retry after lost response
    assert.equal((await db.query('select count(*)::int n from ticket_audit_log')).rows[0].n,1);
    assert.equal((await run()).ticket.ticket_id,id(51));
    assert.equal((await db.query(`select status from tickets where id='${id(50)}'`)).rows[0].status,'valid');
    assert.equal((await run()).result,'already_used');
    assert.equal((await run({subject:id(31),hash:'guest-hash',code:'FIRST'})).ticket.ticket_id,id(50));
    await assert.rejects(run({kind:'trial_pass',subject:id(32),hash:'trial-hash',code:'FIRST'}),/valid unused ticket/);
    assert.equal((await db.query('select current_count from capacity_sessions')).rows[0].current_count,2);
    await assert.rejects(reserve(50,false),/unused valid ticket/);
  }finally{await db.close();}
});

test('guest may arrive first, and reserving every ticket does not silently redeem a guest ticket',async()=>{
  const {db,run,reserve}=await fixture();
  try{
    await reserve(50); await reserve(51); await reserve(52);
    await assert.rejects(run(),/For a guest/);
    assert.equal((await db.query('select count(*)::int n from door_admissions')).rows[0].n,0);
    assert.equal((await run({subject:id(31),hash:'guest-hash',code:'FIRST'})).ok,true);
    await assert.rejects(run(),/For a guest/);
    await reserve(51,false);
    assert.equal((await run()).ticket.ticket_id,id(51));
    assert.equal((await db.query(`select status from tickets where id='${id(52)}'`)).rows[0].status,'valid');
  }finally{await db.close();}
});

test('trial buyer automatic admission also skips guest tickets',async()=>{
  const {db,run,reserve}=await fixture();
  try{
    await db.exec(`update orders set user_id='${id(12)}',member_profile_id=null where id='${id(40)}'`);
    await reserve(50,true,12);
    assert.equal((await run({kind:'trial_pass',subject:id(32),hash:'trial-hash'})).ticket.ticket_id,id(51));
    assert.equal((await run({subject:id(31),hash:'guest-hash',code:'FIRST'})).ticket.ticket_id,id(50));
  }finally{await db.close();}
});

test('reservation checks ownership, verified legacy email, ticket status, RPC privileges and audit rollback',async()=>{
  const {db,reserve}=await fixture();
  try{
    await assert.rejects(reserve(50,true,11),/not found/);
    await assert.rejects(reserve(99),/not found/);
    for(const status of ['used','refunded','void']){
      await db.exec(`update tickets set status='${status}' where id='${id(50)}'`);
      await assert.rejects(reserve(),/unused valid ticket/);
    }
    await db.exec(`update tickets set status='valid'; update orders set status='refunded' where id='${id(40)}'`);
    await assert.rejects(reserve(),/unused valid ticket/);
    await db.exec(`update orders set status='partial_refund' where id='${id(40)}'`);
    await db.exec(`alter table ticket_audit_log add constraint fail_audit check(action<>'ticket.guest_reservation')`);
    await assert.rejects(reserve(),/fail_audit/);
    assert.equal((await db.query(`select reserved_for_guest from tickets where id='${id(50)}'`)).rows[0].reserved_for_guest,false);
    await db.exec('alter table ticket_audit_log drop constraint fail_audit');
    await reserve();
    assert.equal((await reserve(50,false)).reserved_for_guest,false);
    // An unverified email, or a matching email on someone else's linked order, is not ownership.
    await db.exec(`update auth.users set email='owner@example.invalid' where id='${id(11)}'`);
    await assert.rejects(reserve(50,true,11),/not found/);
    await db.exec(`update orders set user_id=null,member_profile_id=null where id='${id(40)}';
      update auth.users set email_confirmed_at=null where id='${id(10)}'`);
    await assert.rejects(reserve(),/not found/);
    await db.exec(`update auth.users set email_confirmed_at=now() where id='${id(10)}';
      update orders set buyer_email='OWNER@EXAMPLE.INVALID' where id='${id(40)}'`);
    assert.equal((await reserve()).reserved_for_guest,true);
    for(const role of ['anon','authenticated']){
      assert.equal((await db.query(`select has_function_privilege('${role}',
        'set_ticket_guest_reservation(uuid,uuid,boolean,boolean)','EXECUTE') allowed`)).rows[0].allowed,false);
    }
    // Even a permissive table grant/RLS policy must not expose this column for direct client writes.
    await db.exec(`set request.jwt.claims='{"role":"authenticated"}'`);
    await assert.rejects(db.exec(`update tickets set reserved_for_guest=false where id='${id(50)}'`),/authenticated guest ticket endpoint/);
    await db.exec(`reset request.jwt.claims`);
  }finally{await db.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { shiftWindow } from '../lib/capacity/arrival-roster.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('security incidents are private, immutable, atomic, idempotent and preserve lifting policy', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      alter default privileges in schema public grant all on tables to service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table team_members(user_id uuid primary key,role text,full_name text,email text);
      create table events(id uuid primary key);
      create table door_sessions(id uuid primary key,event_id uuid references events(id),opened_at timestamptz,closed_at timestamptz);`);
    for (const [n, role, email] of [[1,'admin','adam@sdgatx.com'],[2,'admin','naish@sdgatx.com'],[3,'admin','jeyu@sdgatx.com'],[4,'front_desk','guard@example.invalid'],[5,'admin','other@example.invalid'],[6,'calendar_viewer','viewer@example.invalid']]) {
      await db.query('insert into auth.users values($1)', [id(n)]);
      await db.query('insert into team_members values($1,$2,$3,$4)', [id(n),role,`Test staff ${n}`,email]);
    }
    await db.query('insert into events values($1)', [id(10)]);
    await db.query('insert into door_sessions values($1,$2,now(),null)', [id(11),id(10)]);
    for (const file of ['20260922000000_access_restrictions.sql','20260922010000_restriction_lift_allowlist.sql','20260929190000_security_incidents.sql','20260929202000_security_incident_privileges.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
    }
    const input = { request_id:id(20),subject_key:`member:${id(30)}`,identity_keys:[`member:${id(30)}`,`user:${id(31)}`],
      full_name:'Fictional Guest',category:'photography',action:'warning',note:'Factual test observation.',
      identity_confirmed:true,restriction_confirmed:true,match_keys:['name:fictional guest'] };
    const record = async (data=input,actor=id(4)) => (await db.query('select record_security_incident($1,$2::jsonb) id',[actor,JSON.stringify(data)])).rows[0].id;
    const warning = await record();
    assert.equal(await record(), warning, 'retry is idempotent');
    assert.equal((await db.query('select count(*)::int n from access_restrictions')).rows[0].n,0,'warning is not a ban');
    await assert.rejects(record({...input,note:'Changed payload'}),/already used/);
    await assert.rejects(record({...input,request_id:id(21),identity_confirmed:false}),/identity first/);
    await assert.rejects(record({...input,request_id:id(21),action:'ban',restriction_confirmed:false}),/restriction first/);
    await assert.rejects(record({...input,request_id:id(21)},id(6)),/Not authorized/);
    const ban = await record({...input,request_id:id(22),action:'ban',category:'altercation'});
    const row = (await db.query('select * from security_incidents where id=$1',[ban])).rows[0];
    assert.equal(row.actor_id,id(4)); assert.equal(row.actor_label,'Test staff 4');
    assert.equal(row.event_id,id(10)); assert.equal(row.door_session_id,id(11));
    assert.ok(row.restriction_id);
    assert.equal((await db.query('select kind from access_restrictions where id=$1',[row.restriction_id])).rows[0].kind,'banned');
    assert.equal(await record({...input,request_id:id(22),action:'ban',category:'altercation'}),ban);
    assert.equal((await db.query('select count(*)::int n from access_restrictions')).rows[0].n,1);
    // Force a late constraint failure after the nested restriction INSERT.
    await assert.rejects(record({...input,request_id:id(23),action:'ban',category:'invalid'}));
    assert.equal((await db.query('select count(*)::int n from access_restrictions')).rows[0].n,1,'no orphaned ban after transaction rollback');
    await assert.rejects(db.query('select manage_access_restriction($1,$2,$3::jsonb)',[id(4),'lift',JSON.stringify({id:row.restriction_id,comment:'Attempted guard lift'})]),/authorized managers/);
    await assert.rejects(db.query('select manage_access_restriction($1,$2,$3::jsonb)',[id(5),'lift',JSON.stringify({id:row.restriction_id,comment:'Other admin'})]),/authorized managers/);
    await db.query('select manage_access_restriction($1,$2,$3::jsonb)',[id(2),'lift',JSON.stringify({id:row.restriction_id,comment:'Authorized review'})]);
    const reminder = await db.query('select record_security_reminder($1,$2,$3) id',[id(4),input.identity_keys,[warning]]);
    assert.ok(reminder.rows[0].id);
    const day=(await db.query('select shift_day::text as shift_date from security_warning_reminders')).rows[0].shift_date;
    assert.equal(day,shiftWindow().shiftDay,'SQL and JavaScript use the same Chicago 6am shift boundary');
    await assert.rejects(db.query('select record_security_reminder($1,$2,$3)',[id(4),[`member:${id(99)}`],[warning]]),/do not match/);
    await assert.rejects(db.query('select record_security_reminder($1,$2,$3)',[id(4),input.identity_keys,[ban]]),/do not match/);
    await assert.rejects(db.query('update security_incidents set note=$1 where id=$2',['tampered',warning]),/append-only/);
    await assert.rejects(db.query('delete from security_warning_reminders'),/append-only/);
    const privileges = (await db.query(`select
      has_table_privilege('authenticated','security_incidents','SELECT') as customer_read,
      has_table_privilege('anon','security_warning_reminders','INSERT') as anon_write,
      has_function_privilege('authenticated','record_security_incident(uuid,jsonb)','EXECUTE') as direct_write,
      has_table_privilege('service_role','security_incidents','UPDATE') as rewrite,
      has_table_privilege('service_role','security_incidents','TRUNCATE') as truncate_history`)).rows[0];
    assert.deepEqual(privileges,{customer_read:false,anon_write:false,direct_write:false,rewrite:false,truncate_history:false});
  } finally { await db.close(); }
});

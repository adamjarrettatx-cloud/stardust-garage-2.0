import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('transactional correction, minimum intake name, privileges, legacy compatibility and stable links', async () => {
  const db = new PGlite();
  const desk=id(1), outsider=id(2), user=id(3), member=id(4), guest=id(5), pass=id(6), entry=id(7), order=id(8), ticket=id(9);
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table team_members(user_id uuid primary key, role text, full_name text);
      create table free_accounts(user_id uuid primary key,full_name text,updated_at timestamptz);
      create table member_profiles(id uuid primary key,user_id uuid,full_name text);
      create table guest_profiles(id uuid primary key,full_name text);
      create table trial_passes(id uuid primary key,user_id uuid,member_profile_id uuid,guest_profile_id uuid,full_name text,status text default 'active');
      create table membership_applications(id uuid primary key,full_name text,status text);
      create table event_guestlist_entries(id uuid primary key,guest_profile_id uuid,guest_name text);
      create table orders(id uuid primary key,user_id uuid,member_profile_id uuid,buyer_name text);
      create table tickets(id uuid primary key,order_id uuid,status text);
      insert into auth.users values('${desk}'),('${outsider}'),('${user}');
      insert into team_members values('${desk}','front_desk','Test Staff');
      insert into free_accounts values('${user}','John Doe',now());
      insert into member_profiles values('${member}','${user}','John Doe');
      insert into guest_profiles values('${guest}','Old Alias');
      insert into trial_passes(id,user_id,member_profile_id,guest_profile_id,full_name) values('${pass}','${user}','${member}','${guest}','John Doe');
      insert into event_guestlist_entries values('${entry}','${guest}','John Doe');
      insert into orders values('${order}','${user}','${member}','Historical Buyer');
      insert into tickets values('${ticket}','${order}','used');
      insert into membership_applications values('${id(10)}','Legacy','pending');
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20260923010000_legal_name_corrections.sql', import.meta.url), 'utf8'));
    const correct = (actor, kind, target, old, name='José García') => db.query(
      'select correct_legal_name($1,$2,$3,$4,$5,$6) result', [actor,kind,target,old,name,'Corrected against ID']);
    for (const name of ['John', 'John 123', 'John !!!', '', 'A '.repeat(70)]) {
      await assert.rejects(db.query('insert into membership_applications(id,full_name) values($1,$2)',[id(11),name]));
    }
    for (const name of ['José García','Anne-Marie O’Neill','李 明','محمد علي','A Li','J. Smith']) {
      assert.equal((await db.query('select is_valid_legal_name($1) ok',[name])).rows[0].ok, true, name);
    }
    await db.exec(`update membership_applications set status='reviewed' where id='${id(10)}'`);
    await assert.rejects(correct(outsider,'trial_pass',pass,'John Doe'),/Not authorized/);
    await assert.rejects(correct(desk,'trial_pass',pass,'stale name'),/Name changed/);
    await assert.rejects(correct(desk,'trial_pass',pass,'John Doe','Single'),/first and last/);
    await correct(desk,'trial_pass',pass,'John Doe');
    for (const table of ['free_accounts','member_profiles','guest_profiles','trial_passes']) {
      assert.equal((await db.query(`select full_name from ${table}`)).rows[0].full_name,'José García');
    }
    assert.equal((await db.query('select guest_name from event_guestlist_entries')).rows[0].guest_name,'José García');
    assert.equal((await db.query('select buyer_name from orders')).rows[0].buyer_name,'Historical Buyer');
    assert.equal((await db.query('select status from tickets')).rows[0].status,'used');
    const audit=(await db.query('select * from legal_name_corrections')).rows[0];
    assert.equal(audit.actor_id,desk);
    assert.deepEqual(audit.old_names.sort(),['John Doe','Old Alias'].sort());
    assert.ok(audit.identity_keys.includes(`user:${user}`));
    assert.ok(audit.identity_keys.includes(`guestlist:${entry}`));
    await correct(desk,'ticket',ticket,'José García','Corrected Again');
    await assert.rejects(correct(desk,'trial_pass',pass,'José García'),/Name changed/);
    // Failure of audit insertion must roll back profile writes.
    await db.exec(`alter table legal_name_corrections add constraint test_failure check(new_name<>'Rollback Test')`);
    await assert.rejects(correct(desk,'member',member,'Corrected Again','Rollback Test'));
    assert.equal((await db.query('select full_name from free_accounts')).rows[0].full_name,'Corrected Again');
    const privileges=(await db.query(`select
      has_table_privilege('authenticated','legal_name_corrections','SELECT') as read,
      has_table_privilege('service_role','legal_name_corrections','UPDATE') as mutate_audit,
      has_function_privilege('authenticated','correct_legal_name(uuid,text,uuid,text,text,text)','EXECUTE') as write`)).rows[0];
    assert.deepEqual(privileges,{read:false,mutate_audit:false,write:false});
    // No profile or account on a legacy ticket: correct only its own order.
    await db.exec(`insert into orders values('${id(20)}',null,null,'Old Guest');
      insert into tickets values('${id(21)}','${id(20)}','valid')`);
    await correct(desk,'ticket',id(21),'Old Guest','Legacy Guest');
    assert.equal((await db.query('select buyer_name from orders where id=$1',[id(20)])).rows[0].buyer_name,'Legacy Guest');
  } finally { await db.close(); }
});

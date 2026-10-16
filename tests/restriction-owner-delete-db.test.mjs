import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('only the owner can permanently delete a banned-list entry; deletion is logged', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      alter default privileges in schema public grant all on tables to service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table team_members(user_id uuid primary key,role text,full_name text,email text);
      create table events(id uuid primary key,event_date date,title text,status text,visibility text);
      create table team_events(id uuid primary key,event_date date,title text);
      create table door_sessions(id uuid primary key,event_id uuid,opened_at timestamptz,closed_at timestamptz);
      create table capacity_sessions(id uuid primary key,current_count integer,max_capacity integer,is_active boolean);
      create table capacity_events(session_id uuid,action text,delta integer,count_after integer,max_capacity integer,actor_id uuid,source text,note text);
      create function _capacity_lock_active() returns capacity_sessions language plpgsql security definer as $$
      declare s capacity_sessions; begin select * into s from capacity_sessions where is_active for update; return s; end $$;
      revoke all on function _capacity_lock_active() from public;
      create function correct_legal_name(p_actor uuid,p_kind text,p_id uuid,p_expected_name text,p_name text,p_reason text)
      returns jsonb language plpgsql as $$ declare v_role text; v_label text; begin
        select role,full_name into v_role,v_label from public.team_members where user_id=p_actor;
        if v_role is null or v_role not in ('admin','team','front_desk') then raise exception 'Not authorized' using errcode='42501'; end if;
        return jsonb_build_object('actor',p_actor,'name',v_label);
      end $$;
    `);
    for (const [n, role, email] of [[1, 'admin', 'adam@sdgatx.com'], [2, 'admin', 'naish@sdgatx.com'], [3, 'admin', 'jeyu@sdgatx.com'], [4, 'front_desk', 'desk@example.invalid']]) {
      await db.query('insert into auth.users values($1)', [id(n)]);
      await db.query('insert into team_members values($1,$2,$3,$4)', [id(n), role, `Staff ${n}`, email]);
    }
    await db.query('insert into capacity_sessions values($1,0,20,true)', [id(50)]);
    for (const file of ['20260922000000_access_restrictions.sql', '20260922010000_restriction_lift_allowlist.sql',
      '20260929190000_security_incidents.sql', '20260929202000_security_incident_privileges.sql',
      '20260924170000_front_desk_arrivals.sql', '20260930190000_shared_station_accounts.sql',
      '20260930220000_station_calendar_availability.sql', '20261005210000_front_desk_station_persistent_session.sql',
      '20261016120000_restriction_photos_and_edits.sql', '20261016230000_restriction_owner_delete.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    const make = async (actor, name) => (await db.query(`select public.manage_access_restriction($1,'create',$2::jsonb) id`, [actor,
      JSON.stringify({ full_name: name, kind: 'banned', reason: 'Mistake test', match_keys: [`name:${name.toLowerCase()}`], identity_keys: [] })])).rows[0].id;
    const del = (actor, rid, reason = 'Added by mistake') => db.query('select public.delete_access_restriction($1,$2,$3) p', [actor, rid, reason]);
    const rid = await make(id(4), 'Wrong Person');
    await db.query(`select public.manage_access_restriction($1,'note',$2::jsonb)`, [id(4), JSON.stringify({ id: rid, comment: 'note' })]);
    await db.query(`select public.manage_access_restriction($1,'different_person',$2::jsonb)`, [id(4), JSON.stringify({ id: rid, comment: 'override', identity_keys: ['user:x'], subject_key: 'user:x' })]);
    // Other admins who can lift (Naish, Jeyu) and front desk cannot delete.
    for (const actor of [id(2), id(3), id(4)]) await assert.rejects(del(actor, rid), /Only the owner/);
    await assert.rejects(del(id(1), rid, '  '), /reason/);
    // A non-Adam account that somehow holds the owner flag still cannot delete.
    await db.query('update access_restriction_managers set can_manage_permissions=true where user_id=$1', [id(2)]);
    await assert.rejects(del(id(2), rid), /Only the owner/);
    await del(id(1), rid);
    for (const table of ['access_restrictions', 'access_restriction_events', 'access_restriction_exclusions']) {
      const col = table === 'access_restrictions' ? 'id' : 'restriction_id';
      assert.equal((await db.query(`select count(*)::int n from ${table} where ${col}=$1`, [rid])).rows[0].n, 0, table);
    }
    const log = (await db.query('select full_name, deletion_reason, deleted_by from access_restriction_deletions')).rows;
    assert.deepEqual(log, [{ full_name: 'Wrong Person', deletion_reason: 'Added by mistake', deleted_by: id(1) }]);
    await assert.rejects(del(id(1), rid), /not found/);
    // A ban recorded through a Security Mode incident keeps the incident history.
    const rid2 = await make(id(4), 'Incident Person');
    await db.query(`insert into security_incidents(request_id,subject_key,identity_keys,full_name,category,action,note,actor_id,actor_label,restriction_id)
      values(gen_random_uuid(),'user:y',array['user:y'],'Incident Person','other','ban','Test incident',$1,'Desk',$2)`, [id(4), rid2]);
    await del(id(1), rid2);
    const incident = (await db.query('select restriction_id, restriction_deleted_at from security_incidents')).rows[0];
    assert.equal(incident.restriction_id, null);
    assert.ok(incident.restriction_deleted_at);
    // Outside the owner delete, incident history is still immutable.
    await assert.rejects(db.query(`update security_incidents set note='edited'`), /append-only/);
    await assert.rejects(db.query(`delete from security_incidents`), /append-only/);
    const rid3 = await make(id(4), 'Third Person');
    await db.query(`insert into security_incidents(request_id,subject_key,identity_keys,full_name,category,action,note,actor_id,actor_label,restriction_id)
      values(gen_random_uuid(),'user:z',array['user:z'],'Third Person','other','ban','Test',$1,'Desk',$2)`, [id(4), rid3]);
    await db.query(`select set_config('sdg.restriction_delete',$1,false)`, [rid3]);
    await assert.rejects(db.query(`update security_incidents set restriction_id=null, restriction_deleted_at=now(), note='x' where restriction_id=$1`, [rid3]), /append-only/);
    // Browser roles have no access to the deletion log or function.
    assert.equal((await db.query(`select has_table_privilege('authenticated','public.access_restriction_deletions','select') p`)).rows[0].p, false);
    assert.equal((await db.query(`select has_function_privilege('authenticated','public.delete_access_restriction(uuid,uuid,text)','execute') p`)).rows[0].p, false);
  } finally { await db.close(); }
});

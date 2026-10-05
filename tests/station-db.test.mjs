import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('station SQL enforces owner control, scoped operations, revocation, expiry, immutable audit, and private storage', async () => {
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
      '20260930220000_station_calendar_availability.sql', '20261005210000_front_desk_station_persistent_session.sql']) {
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    const create = async (n, role, username) => {
      await db.query('insert into auth.users values($1)', [id(n)]);
      return (await db.query('select create_station_account($1,$2,$3,$4,$5,$6) a', [id(1), id(n), username, username, role, `${id(n)}@station.sdgatx.invalid`])).rows[0].a;
    };
    const security = await create(10, 'security', 'security');
    const desk = await create(11, 'front_desk', 'front-desk');
    await assert.rejects(db.query('select create_station_account($1,$2,$3,$4,$5,$6)', [id(2), id(12), 'bad-owner', 'Bad', 'security', 'bad@example.invalid']), /Owner required/);
    await assert.rejects(create(12, 'admin', 'admin-station'), /check constraint/);
    await assert.rejects(create(13, 'security', 'security'), /unique constraint/);
    await assert.rejects(db.query('insert into team_members values($1,$2,$3,$4)', [id(10), 'admin', 'Attempt', 'no@example.invalid']), /cannot become team/);
    const open = async (station, hash, epoch = 1) => (await db.query('select open_station_session($1,$2,$3) ok', [station.id, epoch, hash])).rows[0].ok;
    const resolve = async hash => (await db.query('select * from resolve_station_session($1)', [hash])).rows;
    assert.equal(await open(security, 'a'.repeat(64)), true);
    assert.equal(await open(desk, 'b'.repeat(64)), true);
    assert.equal((await resolve('a'.repeat(64)))[0].role, 'security');
    // Front Desk stays signed in; Security keeps its 12-hour session.
    const lifetimes = (await db.query(`select a.role, extract(epoch from s.expires_at - s.created_at) secs
      from station_sessions s join station_accounts a on a.id=s.station_id`)).rows;
    assert.ok(Number(lifetimes.find(r => r.role === 'security').secs) <= 12 * 3600 + 1);
    assert.ok(Number(lifetimes.find(r => r.role === 'front_desk').secs) > 50 * 365 * 86400);
    await assert.rejects(db.query(`insert into station_sessions(token_hash,station_id,epoch,expires_at)
      values($1,$2,1,now()+interval '101 years')`, ['e'.repeat(64), desk.id]), /check constraint/);
    assert.equal((await resolve('c'.repeat(64))).length, 0);
    const calendar = await create(14, 'calendar_availability', 'bookers');
    const hash = 'f'.repeat(64);
    assert.equal(await open(calendar, hash), true);
    const availability = async token => (await db.query('select * from station_calendar_availability($1)', [token])).rows;
    const firstDay = (await db.query("select to_char((now() at time zone 'America/Chicago')::date,'YYYY-MM-DD') d")).rows[0].d;
    await db.query(`insert into events values
      ($1,$4::date,'SECRET internal hold','draft','internal'),
      ($2,$4::date+1,'SECRET unlisted booking','published','unlisted'),
      ($3,$4::date+2,'SECRET public booking','published','public')`, [id(100),id(101),id(102),firstDay]);
    await db.query("insert into team_events values($1,$3::date+3,'SECRET team hold'),($2,$3::date,'SECRET duplicate hold')", [id(103),id(104),firstDay]);
    await db.exec('set role service_role');
    const dates = await availability(hash);
    await db.exec('reset role');
    assert.equal(dates.length,365);
    assert.equal(dates[0].date,firstDay);
    assert.deepEqual(dates.slice(0,4).map(d => d.available),[false,false,false,false]);
    assert.equal(dates[4].available,true);
    assert.equal(JSON.stringify(dates).includes('SECRET'),false);
    assert.deepEqual(Object.keys(dates[0]).sort(),['available','date']);
    for (let i=1;i<365;i++) assert.equal(Date.parse(dates[i].date)-Date.parse(dates[i-1].date),86400000);
    for (const token of ['a'.repeat(64),'b'.repeat(64),'0'.repeat(64)]) await assert.rejects(availability(token),/Not authorized/);
    await assert.rejects(db.query('select station_capacity_operation($1,$2,$3,$4)',[hash,'check_in','front_door','attempt']),/Not authorized/);
    await db.query("select manage_station_access($1,$2,'disable',null)",[id(1),calendar.id]);
    await assert.rejects(availability(hash),/Not authorized/);
    const capacity = async (hash, op) => db.query('select station_capacity_operation($1,$2,$3,$4)', [hash, op, 'front_door', 'Station test']);
    await assert.rejects(capacity('a'.repeat(64), 'check_in'), /Not authorized/);
    await assert.rejects(capacity('b'.repeat(64), 'reset'), /Not authorized/);
    // Test private helper works with the ACTUAL service role (not postgres).
    await db.exec('set role service_role');
    await capacity('b'.repeat(64), 'check_in');
    await db.exec('reset role');
    assert.equal((await db.query('select actor_id from capacity_events')).rows[0].actor_id, id(11));
    const data = { request_id: id(20), subject_key: `member:${id(30)}`, identity_keys: [`member:${id(30)}`],
      match_keys: ['name:test guest'], full_name: 'Test Guest', category: 'altercation', action: 'ban', note: 'Test observation',
      identity_confirmed: true, restriction_confirmed: true };
    const record = async actor => db.query('select record_security_incident($1,$2) id', [actor, data]);
    const incident = (await record(id(10))).rows[0].id;
    await assert.rejects(record(id(11)), /Not authorized/);
    const ban = (await db.query('select restriction_id,actor_label from security_incidents where id=$1', [incident])).rows[0];
    assert.equal(ban.actor_label, 'security');
    for (const actor of [id(10), id(11)]) {
      await assert.rejects(db.query('select manage_access_restriction($1,$2,$3)', [actor, 'lift', { id: ban.restriction_id, comment: 'Attempt' }]), /Not authorized/);
      await assert.rejects(db.query('select manage_access_restriction($1,$2,$3)', [actor, 'manager', { user_id: id(11), enabled: true }]), /Not authorized/);
    }
    await db.query('select manage_access_restriction($1,$2,$3)', [id(11), 'note', { id: ban.restriction_id, comment: 'Front desk note' }]);
    await db.query('select manage_access_restriction($1,$2,$3)', [id(2), 'lift', { id: ban.restriction_id, comment: 'Authorized manager' }]);
    await db.query('select front_desk_roster_check_in($1,$2,$3,$4,$5)', ['guest', id(40), [`guest:${id(40)}`], id(11), null]);
    await assert.rejects(db.query('select front_desk_roster_check_in($1,$2,$3,$4,$5)', ['guest', id(41), [`guest:${id(41)}`], id(10), null]), /Not authorized/);
    await db.query('select correct_legal_name($1,$2,$3,$4,$5,$6)', [id(11), 'guestlist', id(40), 'Old', 'New', 'Correction']);
    await assert.rejects(db.query('select correct_legal_name($1,$2,$3,$4,$5,$6)', [id(10), 'guestlist', id(40), 'Old', 'New', 'Correction']), /Not authorized/);
    const manage = async (station, action, epoch = null) => (await db.query('select manage_station_access($1,$2,$3,$4) a', [id(1), station.id, action, epoch])).rows[0].a;
    await manage(security, 'disable');
    assert.equal((await resolve('a'.repeat(64))).length, 0);
    assert.equal(await open(security, 'c'.repeat(64)), false);
    await assert.rejects(record(id(10)), /Not authorized/);
    await manage(security, 'enable');
    assert.equal((await resolve('a'.repeat(64))).length, 0, 'reenabling must not resurrect sessions');
    assert.equal(await open(security, 'd'.repeat(64), 3), true);
    const reset = await manage(security, 'reset');
    assert.equal((await resolve('d'.repeat(64))).length, 0);
    assert.equal(await open(security, 'e'.repeat(64), reset.epoch), false, 'reset locks login');
    await assert.rejects(manage(security, 'reset'), /already in progress/);
    await assert.rejects(manage(security, 'finish_reset', reset.epoch - 1), /superseded/);
    await manage(security, 'finish_reset', reset.epoch);
    assert.equal(await open(security, 'e'.repeat(64), reset.epoch), true);
    await db.query('select close_station_session($1)', ['e'.repeat(64)]);
    assert.equal((await resolve('e'.repeat(64))).length, 0);
    await db.query("update station_sessions set expires_at=now()-interval '1 second' where token_hash=$1", ['b'.repeat(64)]);
    assert.equal((await resolve('b'.repeat(64))).length, 0);
    await assert.rejects(db.query('delete from station_access_events'), /append-only/);
    assert.equal((await db.query("select has_table_privilege('service_role','station_access_events','TRUNCATE') ok")).rows[0].ok, false);
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['station_accounts', 'station_sessions', 'station_access_events', 'station_login_limits']) {
        assert.equal((await db.query('select has_table_privilege($1,$2,$3) ok', [role, table, 'SELECT'])).rows[0].ok, false);
      }
      assert.equal((await db.query('select has_function_privilege($1,$2,$3) ok', [role, 'resolve_station_session(text)', 'EXECUTE'])).rows[0].ok, false);
      assert.equal((await db.query('select has_function_privilege($1,$2,$3) ok', [role, 'station_capacity_operation(text,text,text,text)', 'EXECUTE'])).rows[0].ok, false);
      assert.equal((await db.query('select has_function_privilege($1,$2,$3) ok', [role, 'station_calendar_availability(text)', 'EXECUTE'])).rows[0].ok, false);
    }
    for (let n = 1; n <= 12; n++) {
      assert.equal((await db.query('select consume_station_login_limit($1,10,900) ok', ['account-hash'])).rows[0].ok, n <= 10);
    }
  } finally { await db.close(); }
});

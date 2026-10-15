import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PROGRAMMER = uuid(1); const PROGRAMMER_B = uuid(2); const DJ = uuid(3); const ADMIN = uuid(9);
const C_PROG = uuid(11); const C_PROG_B = uuid(12); const C_DJ = uuid(13);

function iso(date) { return date.toISOString().slice(0, 10); }

test('programmer calendar hides private events and pitches flow through approval', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table contacts(id uuid primary key, display_name text, primary_contact_name text, contact_type text[], status text default 'active', updated_at timestamptz,
        constraint contacts_contact_type_check check (contact_type <@ array['dj','artist']::text[]));
      create table partner_profiles(user_id uuid, contact_id uuid, is_active boolean, full_name text);
      create table team_members(user_id uuid, role text);
      create table organization_main_contacts(organization_id uuid, person_contact_id uuid);
      create table events(id uuid primary key default gen_random_uuid(), title text not null, event_date date not null, event_time text, event_end_time text,
        description text, slug text unique not null, status text default 'draft', visibility text default 'public', event_type text default 'standard',
        contact_id uuid references contacts(id), is_sdg_only boolean default true, created_at timestamptz default now());
      create table team_events(id uuid primary key default gen_random_uuid(), title text, event_date date);
      create table submission_threads(id uuid primary key default gen_random_uuid(), submission_type text,
        constraint submission_threads_submission_type_check check (submission_type in ('applications')));
      create table submission_notes(id uuid primary key default gen_random_uuid(), submission_type text,
        constraint submission_notes_submission_type_check check (submission_type in ('applications')));
      create function partner_contact_id() returns uuid language sql stable security definer set search_path=public as
        $$ select contact_id from partner_profiles where user_id=auth.uid() and is_active limit 1 $$;
      create function is_admin() returns boolean language sql stable security definer set search_path=public as
        $$ select exists(select 1 from team_members where user_id=auth.uid() and role='admin') $$;
      create function partner_event_contact_ids() returns setof uuid language sql stable security definer set search_path='' as
        $$ select c.id from public.contacts c where c.id = public.partner_contact_id() and c.contact_type && array['organization','event_organizer','collective'] $$;
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261015120000_programmer_date_pitches.sql', import.meta.url), 'utf8'));

    const today = (await db.query(`select public.austin_today() d`)).rows[0].d;
    const base = new Date(today);
    const day = (n) => iso(new Date(base.getTime() + n * 86400000));
    await db.query(`insert into auth.users values ($1,'prog@example.com'),($2,'progb@example.com'),($3,'dj@example.com'),($4,'admin@example.com')`, [PROGRAMMER, PROGRAMMER_B, DJ, ADMIN]);
    await db.query(`insert into contacts(id, display_name, contact_type) values ($1,'Jordan Reyes',array['programmer']),($2,'Sam Lee',array['programmer']),($3,'DJ Lux',array['dj'])`, [C_PROG, C_PROG_B, C_DJ]);
    await db.query(`insert into partner_profiles values ($1,$2,true,'Jordan Reyes'),($3,$4,true,'Sam Lee'),($5,$6,true,'DJ Lux')`, [PROGRAMMER, C_PROG, PROGRAMMER_B, C_PROG_B, DJ, C_DJ]);
    await db.query(`insert into team_members values ($1,'admin')`, [ADMIN]);
    await db.query(`insert into events(title, event_date, event_time, slug, status, visibility, event_type) values
      ('Public Night', $1, '10:00 PM', 'public-night', 'published', 'public', 'standard'),
      ('Secret Draft', $2, '9 PM', 'secret-draft', 'draft', 'public', 'standard'),
      ('Unlisted Show', $3, '9 PM', 'unlisted-show', 'published', 'unlisted', 'standard'),
      ('Private Birthday', $4, '8 PM', 'private-birthday', 'published', 'public', 'micro_party')`, [day(3), day(4), day(5), day(6)]);
    await db.query(`insert into team_events(title, event_date) values ('Tentative hold', $1)`, [day(7)]);

    const as = async (user, sql, params = []) => {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
      try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
    };

    // Calendar: 365 days, public listing only for the published public event.
    const cal = (await as(PROGRAMMER, `select * from public.partner_programming_calendar()`)).rows;
    assert.equal(cal.length, 365);
    const byDay = Object.fromEntries(cal.map((r) => [iso(new Date(r.day)), r]));
    assert.equal(byDay[day(3)].state, 'public');
    assert.equal(byDay[day(3)].title, 'Public Night');
    assert.equal(byDay[day(3)].slug, 'public-night');
    for (const n of [4, 5, 6, 7]) {
      assert.equal(byDay[day(n)].state, 'unavailable', `day +${n}`);
      assert.equal(byDay[day(n)].title, null);
      assert.equal(byDay[day(n)].slug, null);
    }
    assert.equal(byDay[day(10)].state, 'open');
    const leaked = JSON.stringify(cal);
    for (const secret of ['Secret Draft', 'Unlisted Show', 'Private Birthday', 'Tentative hold']) assert.ok(!leaked.includes(secret));

    // Non-programmers and anonymous callers are refused.
    await assert.rejects(as(DJ, `select * from public.partner_programming_calendar()`), /Not available/);
    await db.exec(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.exec('set role anon');
    await assert.rejects(db.query(`select * from public.partner_programming_calendar()`), /permission denied/);
    await db.exec('reset role');

    // Direct table access is closed to partners.
    await assert.rejects(as(PROGRAMMER, `insert into public.date_pitches(contact_id, pitch_date, title, concept, start_time, end_time, expected_attendance) values ($1, $2, 'x','y','22:00','02:00','under_100')`, [C_PROG, day(10)]), /permission denied/);
    assert.equal((await as(PROGRAMMER, `select count(*)::int n from public.date_pitches`)).rows[0].n, 0);

    const submit = (user, date, title = 'Velvet Static') => as(user, `select public.partner_submit_pitch($1, $2, 'A shoegaze night', 'Band A', '22:00', '02:00', '100_250', null) id`, [date, title]);
    await assert.rejects(submit(PROGRAMMER, day(3)), /no longer open/);
    await assert.rejects(submit(PROGRAMMER, day(4)), /no longer open/);
    await assert.rejects(submit(PROGRAMMER, day(-1)), /next 12 months/);
    await assert.rejects(submit(PROGRAMMER, day(400)), /next 12 months/);
    await assert.rejects(submit(DJ, day(10)), /Not available/);

    const a = (await submit(PROGRAMMER, day(10))).rows[0].id;
    await assert.rejects(submit(PROGRAMMER, day(10)), /already have a pitch/);
    const b = (await submit(PROGRAMMER_B, day(10), 'Competing Night')).rows[0].id;
    const c = (await submit(PROGRAMMER_B, day(11), 'Other Night')).rows[0].id;

    // A pitch does not hold the date.
    const after = (await as(PROGRAMMER, `select state from public.partner_programming_calendar() where day = $1`, [day(10)])).rows[0];
    assert.equal(after.state, 'open');

    // Each Programmer sees only their own pitches, with an email snapshot.
    const mineA = (await as(PROGRAMMER, `select * from public.partner_my_pitches()`)).rows;
    assert.deepEqual(mineA.map((p) => p.id), [a]);
    const rowA = (await db.query(`select email, full_name, applicant_user_id from date_pitches where id=$1`, [a])).rows[0];
    assert.deepEqual(rowA, { email: 'prog@example.com', full_name: 'Jordan Reyes', applicant_user_id: PROGRAMMER });

    // Only the owner can withdraw.
    assert.equal((await as(PROGRAMMER, `select public.partner_withdraw_pitch($1) ok`, [c])).rows[0].ok, false);

    // Only admins decide.
    await assert.rejects(as(PROGRAMMER, `select public.approve_date_pitch($1)`, [a]), /Administrators only/);
    assert.equal((await as(ADMIN, `select count(*)::int n from public.date_pitches`)).rows[0].n, 3);

    const eventId = (await as(ADMIN, `select public.approve_date_pitch($1) id`, [a])).rows[0].id;
    const ev = (await db.query(`select title, event_date, event_time, event_end_time, status, visibility, contact_id, is_sdg_only, slug, description from events where id=$1`, [eventId])).rows[0];
    assert.equal(ev.title, 'Velvet Static');
    assert.equal(iso(new Date(ev.event_date)), day(10));
    assert.equal(ev.event_time, '10:00 PM');
    assert.equal(ev.event_end_time, '2:00 AM');
    assert.equal(ev.status, 'draft');
    assert.equal(ev.visibility, 'public');
    assert.equal(ev.contact_id, C_PROG);
    assert.equal(ev.is_sdg_only, false);
    assert.equal(ev.slug, `velvet-static-${day(10)}`);
    assert.match(ev.description, /Lineup: Band A/);
    const types = (await db.query(`select contact_type from contacts where id=$1`, [C_PROG])).rows[0].contact_type;
    assert.deepEqual(types, ['programmer', 'event_organizer']);

    const statuses = Object.fromEntries((await db.query(`select id, status, decline_reason from date_pitches`)).rows.map((r) => [r.id, r]));
    assert.equal(statuses[a].status, 'approved');
    assert.equal(statuses[b].status, 'declined');
    assert.equal(statuses[b].decline_reason, 'Date filled');
    assert.equal(statuses[c].status, 'pending');
    await assert.rejects(as(ADMIN, `select public.approve_date_pitch($1)`, [a]), /already been decided/);

    // The approved draft makes the date unavailable, with no title shown.
    const filled = (await as(PROGRAMMER_B, `select state, title from public.partner_programming_calendar() where day = $1`, [day(10)])).rows[0];
    assert.deepEqual(filled, { state: 'unavailable', title: null });

    assert.equal((await as(ADMIN, `select public.decline_date_pitch($1, 'Not this season') ok`, [c])).rows[0].ok, true);
    assert.equal((await db.query(`select decline_reason from date_pitches where id=$1`, [c])).rows[0].decline_reason, 'Not this season');

    // Capability helper.
    assert.equal((await as(PROGRAMMER, `select public.partner_has_capability('calendar') v`)).rows[0].v, true);
    assert.equal((await as(DJ, `select public.partner_has_capability('pitches') v`)).rows[0].v, false);

    // Conversations and notes accept the new type.
    await db.query(`insert into submission_threads(submission_type) values ('date-pitches')`);
    await db.query(`insert into submission_notes(submission_type) values ('date-pitches')`);
  } finally {
    await db.close();
  }
});

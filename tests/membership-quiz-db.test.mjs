import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('quiz account isolation, no browser writes, legacy preservation and account deletion', async () => {
  const db = new PGlite();
  const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002';
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
      create table public.membership_applications(id uuid primary key, full_name text);
      alter table public.membership_applications enable row level security;
      grant insert on public.membership_applications to anon,authenticated;
      create policy "Anyone can submit a membership application" on public.membership_applications for insert to anon,authenticated with check(true);
      insert into auth.users values('${a}'),('${b}');
      insert into membership_applications values('${a}','Legacy Applicant');
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261001030000_membership_quiz.sql', import.meta.url), 'utf8'));
    await db.exec(`insert into membership_quiz_results(user_id,answers,recommended_plans,selected_plan) values
      ('${a}','{"age":30}',array['cowork-party'],'cowork-party'),
      ('${b}','{"age":45}',array['weekender'],'weekender');`);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${a}',false);`);
    assert.deepEqual((await db.query('select user_id from membership_quiz_results')).rows.map(r => r.user_id), [a]);
    assert.equal((await db.query(`select count(*)::int n from membership_quiz_results where user_id='${b}'`)).rows[0].n, 0);
    await assert.rejects(db.exec(`update membership_quiz_results set selected_plan='weekender' where user_id='${a}'`), /permission denied/);
    await assert.rejects(db.exec(`insert into membership_applications(id) values('${b}')`), /permission denied/);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from membership_quiz_results'), /permission denied/);
    await db.exec('reset role;');
    assert.equal((await db.query('select full_name from membership_applications')).rows[0].full_name, 'Legacy Applicant');
    await db.exec(`delete from auth.users where id='${a}'`);
    assert.equal((await db.query(`select count(*)::int n from membership_quiz_results where user_id='${a}'`)).rows[0].n, 0);
  } finally { await db.close(); }
});

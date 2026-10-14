import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADMIN = uuid(1);
const JANE = uuid(2);
const STRANGER = uuid(3);

test('conversation tables: participant-only reads, admin reads, no browser writes, tokens server-only', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.team_members(user_id uuid, role text);
      create function public.is_admin() returns boolean language sql stable security definer as
        $$ select exists(select 1 from public.team_members where user_id = auth.uid() and role = 'admin') $$;
      insert into auth.users values ('${ADMIN}','adam@sdgatx.com'),('${JANE}','jane@example.com'),('${STRANGER}','x@example.com');
      insert into public.team_members values ('${ADMIN}','admin');
    `);
    await db.exec(await readFile(new URL('../supabase/migrations/20261014150000_submission_conversations.sql', import.meta.url), 'utf8'));
    await db.exec(`
      grant usage on schema public to authenticated, anon;
      grant select on all tables in schema public to authenticated, anon;
      grant execute on function public.is_admin() to authenticated;
      -- The migration revokes what Supabase's default grants would allow; re-run its revokes after the broad grant above.
      revoke all on public.submission_threads from anon;
      revoke all on public.submission_thread_messages from anon;
      revoke all on public.submission_thread_invites from anon, authenticated;
      insert into public.submission_threads(id, submission_type, submission_id, subject, invite_email, participant_user_id, last_team_message_at)
        values ('${uuid(10)}','venue-inquiries','${uuid(20)}','Album Release','jane@example.com','${JANE}', now()),
               ('${uuid(11)}','collaborations','${uuid(21)}','Collab','other@example.com', null, null);
      insert into public.submission_thread_messages(thread_id, author_kind, kind, body) values ('${uuid(10)}','team','question','Headcount?');
      insert into public.submission_thread_messages(thread_id, author_kind, body, deleted_at) values ('${uuid(10)}','team','removed', now());
      insert into public.submission_thread_invites(thread_id, token_hash, email) values ('${uuid(11)}', repeat('a',64), 'other@example.com');
    `);

    const as = async (sub, sql) => {
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${sub}',false);`);
      try { return await db.query(sql); } finally { await db.exec('reset role;'); }
    };

    const janeThreads = await as(JANE, 'select id, unread_by_guest, awaiting_team from public.submission_threads');
    assert.deepEqual(janeThreads.rows.map((r) => r.id), [uuid(10)]);
    assert.equal(janeThreads.rows[0].unread_by_guest, true);
    assert.equal(janeThreads.rows[0].awaiting_team, false);
    assert.equal((await as(JANE, 'select body from public.submission_thread_messages')).rows.length, 1, 'soft-deleted hidden');
    assert.equal((await as(STRANGER, 'select id from public.submission_threads')).rows.length, 0);
    assert.equal((await as(STRANGER, 'select id from public.submission_thread_messages')).rows.length, 0);
    assert.equal((await as(ADMIN, 'select id from public.submission_threads')).rows.length, 2);
    assert.equal((await as(ADMIN, 'select id from public.submission_thread_messages')).rows.length, 2, 'admins see audit rows');

    await assert.rejects(as(ADMIN, 'select * from public.submission_thread_invites'), /permission denied/);
    await assert.rejects(as(JANE, `insert into public.submission_thread_messages(thread_id, author_kind, body) values ('${uuid(10)}','guest','hi')`), /permission denied/);
    await assert.rejects(as(JANE, `update public.submission_threads set participant_user_id = '${STRANGER}'`), /permission denied/);

    // Table constraints.
    await assert.rejects(db.exec(`insert into public.submission_thread_messages(thread_id, author_kind, kind, body) values ('${uuid(10)}','guest','question','q')`), /check/);
    await assert.rejects(db.exec(`insert into public.submission_threads(submission_type, submission_id, subject, invite_email) values ('venue-inquiries','${uuid(20)}','Dup','jane@example.com')`), /unique|duplicate/);
    await assert.rejects(db.exec(`insert into public.submission_threads(submission_type, submission_id, subject, invite_email) values ('signups','${uuid(22)}','S','jane@example.com')`), /check/);
    await assert.rejects(db.exec(`insert into public.submission_threads(submission_type, submission_id, subject, invite_email) values ('collaborations','${uuid(23)}','S','Jane@Example.com')`), /check/);

    // Generated inbox flag flips when the guest replies after the team read.
    await db.exec(`update public.submission_threads set last_guest_message_at = now() + interval '1 minute', team_last_read_at = now() where id = '${uuid(10)}'`);
    assert.equal((await db.query(`select awaiting_team from public.submission_threads where id = '${uuid(10)}'`)).rows[0].awaiting_team, true);
  } finally {
    await db.close();
  }
});

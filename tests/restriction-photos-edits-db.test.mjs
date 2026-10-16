import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const sql = name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
test('restriction edits, photo paths and stored contact fields', async () => {
  const db = new PGlite();
  const desk = '00000000-0000-4000-8000-000000000002';
  const outsider = '00000000-0000-4000-8000-000000000004';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.team_members(user_id uuid primary key,role text,full_name text);
      insert into auth.users values('${desk}'),('${outsider}');
      insert into public.team_members values('${desk}','front_desk','Desk');`);
    await db.exec(await sql('20260922000000_access_restrictions'));
    const legacy = (await db.query(`select public.manage_access_restriction($1,'create',$2::jsonb) id`, [desk,
      JSON.stringify({ full_name: 'Legacy Guest', kind: 'banned', reason: 'Old', match_keys: ['name:legacy guest', 'email:old@example.invalid'], identity_keys: [] })])).rows[0].id;
    await db.exec(await sql('20261016120000_restriction_photos_and_edits'));
    assert.equal((await db.query('select email from access_restrictions where id=$1', [legacy])).rows[0].email, 'old@example.invalid');
    const id = (await db.query(`select public.manage_access_restriction($1,'create',$2::jsonb) id`, [desk,
      JSON.stringify({ full_name: 'Jade Gonzalez', kind: 'banned', reason: 'Conduct', aliases: ['Jada G'], email: 'j@example.invalid', phone: '512 555 0100',
        match_keys: ['name:jade gonzalez'], identity_keys: [] })])).rows[0].id;
    let row = (await db.query('select * from access_restrictions where id=$1', [id])).rows[0];
    assert.deepEqual(row.aliases, ['Jada G']);
    assert.equal(row.phone, '512 555 0100');
    const update = (actor, data) => db.query('select public.update_access_restriction($1,$2::jsonb)', [actor, JSON.stringify({ id, ...data })]);
    await update(desk, { full_name: 'Jada Gonzalez', match_keys: ['name:jada gonzalez'] });
    row = (await db.query('select * from access_restrictions where id=$1', [id])).rows[0];
    assert.equal(row.full_name, 'Jada Gonzalez');
    assert.ok(row.match_keys.includes('name:jade gonzalez') && row.match_keys.includes('name:jada gonzalez'), 'old names keep matching');
    await update(desk, { photo_path: `${id}/11111111-1111-4111-8111-111111111111.jpg` });
    assert.ok((await db.query('select photo_updated_at from access_restrictions where id=$1', [id])).rows[0].photo_updated_at);
    await assert.rejects(update(desk, { photo_path: `../other/x.jpg` }), /Invalid photo/);
    await assert.rejects(update(desk, { photo_path: `00000000-0000-4000-8000-000000000099/11111111-1111-4111-8111-111111111111.jpg` }), /Invalid photo/);
    await assert.rejects(update(outsider, { full_name: 'X Y' }), /Not authorized/);
    await assert.rejects(update(desk, { full_name: 'Jada Gonzalez' }), /No changes/);
    const events = (await db.query(`select action, comment from access_restriction_events where restriction_id=$1 and action='updated' order by created_at`, [id])).rows;
    assert.equal(events.length, 2);
    assert.match(events[0].comment, /name/);
    assert.match(events[1].comment, /photo added/);
    // Overrides still work and the confirmed-identity protection is intact.
    await db.query(`select public.manage_access_restriction($1,'different_person',$2::jsonb)`, [desk,
      JSON.stringify({ id, comment: 'Photos do not match', identity_keys: ['user:abc'], subject_key: 'user:abc' })]);
    assert.equal((await db.query(`select count(*)::int n from access_restriction_exclusions where restriction_id=$1 and subject_key='user:abc'`, [id])).rows[0].n, 1);
  } finally { await db.close(); }
});

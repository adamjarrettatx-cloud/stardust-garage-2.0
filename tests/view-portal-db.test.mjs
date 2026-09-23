import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('preview registry is private and launch nonces cannot be replayed', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      insert into auth.users values ('00000000-0000-4000-8000-000000000001');`);
    await db.exec(await readFile(new URL('../supabase/preview/view_portal.sql', import.meta.url), 'utf8'));
    await db.exec(`insert into view_portal_personas(persona_id,user_id) values ('free','00000000-0000-4000-8000-000000000001');
      insert into view_portal_redemptions(nonce,owner_id,persona_id) values
      ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','free');`);
    await assert.rejects(db.exec(`insert into view_portal_redemptions(nonce,owner_id,persona_id) values
      ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','free');`), /duplicate key/);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from view_portal_personas'), /permission denied/);
    await assert.rejects(db.query('select * from view_portal_redemptions'), /permission denied/);
  } finally { await db.close(); }
});

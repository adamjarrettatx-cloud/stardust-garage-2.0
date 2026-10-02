import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { ownsAccountPhoto } from '../lib/profile-photo.js';
test('account photo signing rejects foreign paths and traversal',async()=>{
  assert.equal(await ownsAccountPhoto({},'b/photo.jpg','a'),false);
  assert.equal(await ownsAccountPhoto({},'a/../b/photo.jpg','a'),false);
  assert.equal(await ownsAccountPhoto({},'a/photo.jpg','a'),true);
  assert.equal(await ownsAccountPhoto({},'https://evil.invalid/photo.jpg','a'),false);
});
test('database refuses client photo-pointer writes through either RPC or direct tables',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create function auth.uid() returns uuid language sql as $$ select '11111111-1111-4111-8111-111111111111'::uuid $$;
      create function auth.role() returns text language sql as $$ select current_setting('request.jwt.claim.role',true) $$;
      create table auth.users(id uuid primary key,email text);
      create table free_accounts(user_id uuid,full_name text,email text,profile_photo_path text);
      create table member_profiles(user_id uuid,full_name text,phone text,notification_preferences jsonb,profile_photo_path text);
      create function create_own_free_account(text,text,text) returns void language sql as $$select$$;
      insert into auth.users values(auth.uid(),'real@example.invalid');
      insert into free_accounts values(auth.uid(),'Name','real@example.invalid','own/photo.jpg');
      insert into member_profiles values(auth.uid(),'Name','',null,'own/photo.jpg');`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261002010000_account_photo_ownership.sql',import.meta.url),'utf8'));
    await db.exec(`select set_config('request.jwt.claim.role','authenticated',false)`);
    await assert.rejects(db.query(`select update_own_free_account_display('Name','fake@example.invalid','victim/photo.jpg')`),/upload endpoint/);
    await assert.rejects(db.query(`select update_own_member_profile_display('Name','','{}','victim/photo.jpg')`),/upload endpoint/);
    await assert.rejects(db.query(`update free_accounts set profile_photo_path='victim/photo.jpg'`),/server managed/);
    await assert.rejects(db.query(`update member_profiles set profile_photo_path=null`),/server managed/);
    await db.exec(`select update_own_free_account_display('New Name','fake@example.invalid','own/photo.jpg')`);
    assert.equal((await db.query('select email from free_accounts')).rows[0].email,'real@example.invalid');
    assert.equal((await db.query(`select has_function_privilege('anon','update_own_free_account_display(text,text,text)','execute') allowed`)).rows[0].allowed,false);
    await db.exec(`select set_config('request.jwt.claim.role','service_role',false);update free_accounts set profile_photo_path='uploaded/photo.jpg'`);
  }finally{await db.close();}
});

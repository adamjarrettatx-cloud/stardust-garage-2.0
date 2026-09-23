import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
  new URL('../supabase/migrations/20260923193000_profile_photo_validation_foundation.sql', import.meta.url),
  'utf8',
);

const userId = '11111111-1111-4111-8111-111111111111';
const uploadId = '22222222-2222-4222-8222-222222222222';
const leaseId = '33333333-3333-4333-8333-333333333333';
const photoId = '44444444-4444-4444-8444-444444444444';

let db;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.role() returns text language sql stable
      as $$ select coalesce(current_setting('request.jwt.claim.role', true), '') $$;
    create table storage.buckets(
      id text primary key, name text not null, public boolean,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table public.free_accounts(
      id uuid primary key default gen_random_uuid(), user_id uuid unique,
      profile_photo_path text, profile_photo_uploaded_at timestamptz,
      updated_at timestamptz
    );
    create table public.member_profiles(
      id uuid primary key default gen_random_uuid(), user_id uuid unique,
      profile_photo_path text
    );
  `);
  await db.exec(migration);
}, 30000);

beforeEach(async () => {
  await db.exec(`
    truncate profile_photo_events, profile_photo_cleanup_jobs,
      profile_photo_uploads, profile_photo_subjects, profile_photo_assets,
      member_profiles, free_accounts, auth.users cascade;
    insert into auth.users(id) values ('${userId}');
    insert into free_accounts(user_id) values ('${userId}');
    insert into member_profiles(user_id) values ('${userId}');
    select set_config('request.jwt.claim.role', 'service_role', false);
    insert into profile_photo_uploads(
      id, subject_kind, subject_id, user_id, context, idempotency_key,
      request_fingerprint, temporary_storage_path, declared_mime_type,
      declared_byte_size, policy_version, notice_version, expires_at
    ) values (
      '${uploadId}', 'account', '${userId}', '${userId}', 'account', 'key-1',
      repeat('a',64), 'uploads/${uploadId}/original', 'image/jpeg',
      100000, 'face_photo_v1', 'photo_notice_v1', now() + interval '15 minutes'
    );
  `);
});

afterAll(async () => {
  await db?.close();
});

async function claim(id = leaseId) {
  const result = await db.query(
    'select claim_profile_photo_upload($1,$2,$3) as result',
    [uploadId, userId, id],
  );
  return result.rows[0].result;
}

async function commit(id = photoId) {
  const result = await db.query(
    'select commit_profile_photo_asset($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as result',
    [
      uploadId, userId, leaseId, id, `assets/${id}.jpg`, 'b'.repeat(64),
      1000, 1000, 120000, 'aws_rekognition', 'request-1',
    ],
  );
  return result.rows[0].result;
}

describe('profile photo validation database foundation', () => {
  it('keeps all foundation tables and functions unavailable to clients', async () => {
    const privileges = await db.query(`
      select role_name,
        has_table_privilege(role_name, 'profile_photo_uploads', 'SELECT') as upload_read,
        has_table_privilege(role_name, 'profile_photo_assets', 'INSERT') as asset_write,
        has_function_privilege(
          role_name, 'claim_profile_photo_upload(uuid,uuid,uuid)', 'EXECUTE'
        ) as claim
      from (values ('anon'), ('authenticated')) roles(role_name)
    `);
    for (const row of privileges.rows) {
      expect(row).toMatchObject({ upload_read: false, asset_write: false, claim: false });
    }
  });

  it('claims once and blocks a concurrent lease', async () => {
    expect(await claim()).toMatchObject({
      terminal: false,
      temporary_storage_path: `uploads/${uploadId}/original`,
    });
    await expect(claim('55555555-5555-4555-8555-555555555555'))
      .rejects.toThrow('profile_photo_busy');
  });

  it('caps claims at three and never accepts a stale lease', async () => {
    await claim();
    await db.exec(`update profile_photo_uploads set processing_lease_until = now() - interval '1 second'`);
    await expect(commit()).rejects.toThrow('profile_photo_lease_lost');
    await claim('55555555-5555-4555-8555-555555555555');
    await expect(commit()).rejects.toThrow('profile_photo_lease_lost');
    await db.exec(`update profile_photo_uploads set processing_lease_until = now() - interval '1 second'`);
    await claim();
    await db.exec(`update profile_photo_uploads set processing_lease_until = now() - interval '1 second'`);
    await expect(claim()).rejects.toThrow('profile_photo_attempts_exhausted');
  });

  it('persists expiry rather than rolling back an update with an exception', async () => {
    await db.exec(`update profile_photo_uploads set expires_at = now() - interval '1 second'`);
    expect(await claim()).toMatchObject({ terminal: true, state: 'expired' });
    expect((await db.query('select state from profile_photo_uploads')).rows[0].state).toBe('expired');
  });

  it('rejects cross-account and null-lease claims', async () => {
    await expect(db.query('select claim_profile_photo_upload($1,$2,$3)',
      [uploadId, photoId, leaseId])).rejects.toThrow('profile_photo_not_found');
    await expect(claim(null)).rejects.toThrow('profile_photo_invalid_claim');
  });

  it('replays a committed photo without inserting again, even after expiry', async () => {
    await claim();
    await commit();
    await db.exec(`update profile_photo_uploads set expires_at = now() - interval '1 second'`);
    expect(await claim()).toMatchObject({ terminal: true, state: 'accepted', photo_id: photoId });
    expect(await commit()).toMatchObject({ replayed: true, photo_id: photoId });
    await expect(commit('55555555-5555-4555-8555-555555555555'))
      .rejects.toThrow('profile_photo_already_committed');
    expect((await db.query('select count(*)::int n from profile_photo_assets')).rows[0].n).toBe(1);
  });

  it('prevents commit after expiry and leaves the prior photo untouched', async () => {
    await db.exec(`update free_accounts set profile_photo_path = 'legacy-photo.jpg'`);
    await claim();
    await db.exec(`update profile_photo_uploads set expires_at = now() - interval '1 second'`);
    await expect(commit()).rejects.toThrow('profile_photo_expired');
    expect((await db.query('select profile_photo_path from free_accounts')).rows[0].profile_photo_path)
      .toBe('legacy-photo.jpg');
  });

  it('releases retryable leases but ignores stale retry callbacks', async () => {
    await claim();
    await db.query('select retry_profile_photo_upload($1,$2,$3,$4)',
      [uploadId,userId,leaseId,'PROVIDER_UNAVAILABLE']);
    await claim('55555555-5555-4555-8555-555555555555');
    await expect(db.query('select retry_profile_photo_upload($1,$2,$3,$4)',
      [uploadId,userId,leaseId,'PROVIDER_UNAVAILABLE'])).rejects.toThrow('profile_photo_lease_lost');
  });

  it('prevents accepted asset snapshot edits', async () => {
    await claim(); await commit();
    await expect(db.exec(`update profile_photo_assets set normalized_sha256 = repeat('c',64)`))
      .rejects.toThrow('profile_photo_asset_immutable');
  });

  it('preserves current photo on rejection and queues temporary cleanup', async () => {
    await db.exec(`update free_accounts set profile_photo_path = 'legacy-photo.jpg'`);
    await claim();
    await db.query('select reject_profile_photo_upload($1,$2,$3,$4)', [uploadId,userId,leaseId,'NO_FACE']);
    expect((await db.query('select profile_photo_path from free_accounts')).rows[0].profile_photo_path)
      .toBe('legacy-photo.jpg');
    expect((await db.query('select storage_bucket,storage_path from profile_photo_cleanup_jobs')).rows[0])
      .toEqual({ storage_bucket: 'profile-photo-uploads', storage_path: `uploads/${uploadId}/original` });
    expect(await claim()).toMatchObject({ terminal: true, state: 'rejected', reason_code: 'NO_FACE' });
  });

  it('checks the service role inside privileged functions, not just GRANTs', async () => {
    await db.exec(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
    await expect(claim()).rejects.toThrow('permission denied');
  });

  it('atomically commits the accepted asset and compatibility projections', async () => {
    await claim();
    const result = await commit();
    expect(result).toMatchObject({
      photo_id: photoId,
      policy_version: 'face_photo_v1',
      subject_revision: 1,
    });
    const rows = await db.query(`
      select
        (select state from profile_photo_uploads where id = '${uploadId}') as state,
        (select current_photo_id from profile_photo_subjects
          where subject_kind = 'account' and subject_id = '${userId}') as current_photo_id,
        (select profile_photo_path from free_accounts where user_id = '${userId}') as free_path,
        (select profile_photo_path from member_profiles where user_id = '${userId}') as member_path
    `);
    expect(rows.rows[0]).toMatchObject({
      state: 'accepted',
      current_photo_id: photoId,
      free_path: `assets/${photoId}.jpg`,
      member_path: `assets/${photoId}.jpg`,
    });
  });

  it('rejects a stale subject revision without changing the current photo', async () => {
    await db.exec(`
      insert into profile_photo_subjects(subject_kind,subject_id,owner_user_id,revision)
      values ('account','${userId}','${userId}',1)
    `);
    await claim();
    await expect(commit()).rejects.toThrow('profile_photo_conflict');
    expect((await db.query('select count(*)::int as count from profile_photo_assets')).rows[0].count)
      .toBe(0);
  });

  it('records policy rejection without creating an asset', async () => {
    await claim();
    await db.query(
      'select reject_profile_photo_upload($1,$2,$3,$4)',
      [uploadId, userId, leaseId, 'NO_FACE'],
    );
    const row = (await db.query(
      `select state, reason_code from profile_photo_uploads where id = '${uploadId}'`,
    )).rows[0];
    expect(row).toEqual({ state: 'rejected', reason_code: 'NO_FACE' });
    expect((await db.query('select count(*)::int as count from profile_photo_events')).rows[0].count)
      .toBe(1);
  });
});

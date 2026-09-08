import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_PROFILE_PHOTO_MIME,
  MAX_PROFILE_PHOTO_BYTES,
  PROFILE_PHOTO_BUCKET,
  PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS,
  createProfilePhotoSignedUrl,
  extForMime,
  profilePhotoStoragePath,
} from '../lib/profile-photo.js';

test('bucket constant is the private bucket name', () => {
  assert.equal(PROFILE_PHOTO_BUCKET, 'profile-photos');
});

test('size cap is 5 MB', () => {
  assert.equal(MAX_PROFILE_PHOTO_BYTES, 5 * 1024 * 1024);
});

test('allowed mime types include phone-camera formats', () => {
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
    assert.ok(ALLOWED_PROFILE_PHOTO_MIME.includes(mime), `missing ${mime}`);
  }
});

test('extForMime maps known types and defaults to jpg', () => {
  assert.equal(extForMime('image/jpeg'), 'jpg');
  assert.equal(extForMime('image/png'), 'png');
  assert.equal(extForMime('image/webp'), 'webp');
  assert.equal(extForMime('image/heic'), 'heic');
  assert.equal(extForMime('image/heif'), 'heif');
  assert.equal(extForMime('application/pdf'), 'jpg');
  assert.equal(extForMime(undefined), 'jpg');
});

test('profilePhotoStoragePath uses <user_id>/photo.<ext>', () => {
  assert.equal(profilePhotoStoragePath('user-123', 'jpg'), 'user-123/photo.jpg');
  assert.equal(profilePhotoStoragePath('user-abc', 'webp'), 'user-abc/photo.webp');
});

test('profilePhotoStoragePath sanitizes the extension', () => {
  assert.equal(profilePhotoStoragePath('u', '../png'), 'u/photo.png');
  assert.equal(profilePhotoStoragePath('u', 'JPG'), 'u/photo.jpg');
  assert.equal(profilePhotoStoragePath('u', ''), 'u/photo.jpg');
  assert.equal(profilePhotoStoragePath('u', 'w e b p!'), 'u/photo.webp');
});

test('profilePhotoStoragePath throws without a user id', () => {
  assert.throws(() => profilePhotoStoragePath(''));
  assert.throws(() => profilePhotoStoragePath(null));
  assert.throws(() => profilePhotoStoragePath(undefined));
});

test('createProfilePhotoSignedUrl returns null on missing inputs', async () => {
  assert.equal(await createProfilePhotoSignedUrl(null, 'u/p.jpg'), null);
  assert.equal(await createProfilePhotoSignedUrl({}, ''), null);
});

test('createProfilePhotoSignedUrl uses the private bucket and default TTL', async () => {
  const calls = [];
  const admin = {
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path, ttl) {
            calls.push({ bucket, path, ttl });
            return { data: { signedUrl: `https://example.test/${bucket}/${path}?ttl=${ttl}` }, error: null };
          },
        };
      },
    },
  };
  const before = Date.now();
  const res = await createProfilePhotoSignedUrl(admin, 'user-1/photo.jpg');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bucket, 'profile-photos');
  assert.equal(calls[0].path, 'user-1/photo.jpg');
  assert.equal(calls[0].ttl, PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS);
  assert.ok(res?.signedUrl?.includes('user-1/photo.jpg'));
  // expiresAt should be roughly now + TTL
  const expiresMs = new Date(res.expiresAt).getTime();
  const expected = before + PROFILE_PHOTO_SIGNED_URL_TTL_SECONDS * 1000;
  assert.ok(Math.abs(expiresMs - expected) < 2000);
});

test('createProfilePhotoSignedUrl swallows errors as null', async () => {
  const admin = {
    storage: {
      from() { return { async createSignedUrl() { throw new Error('boom'); } }; },
    },
  };
  assert.equal(await createProfilePhotoSignedUrl(admin, 'u/p.jpg'), null);
});

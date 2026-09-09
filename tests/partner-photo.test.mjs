import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCEPTED_PHOTO_TYPES,
  MAX_PHOTO_BYTES,
  PHOTO_BUCKET,
  partnerPhotoFilename,
  uploadPartnerPhoto,
  validatePhotoFile,
} from '../lib/partner-photo.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const file = (overrides = {}) => ({
  name: 'headshot.jpg',
  type: 'image/jpeg',
  size: 1024,
  ...overrides,
});

test('validatePhotoFile accepts the three permitted image types', () => {
  for (const type of ACCEPTED_PHOTO_TYPES) assert.equal(validatePhotoFile(file({ type })), null);
});

test('validatePhotoFile rejects the wrong type, an oversized file and nothing at all', () => {
  assert.match(validatePhotoFile(file({ type: 'application/pdf' })), /JPG, PNG or WebP/);
  assert.match(validatePhotoFile(file({ size: MAX_PHOTO_BYTES + 1 })), /over 5MB/);
  assert.equal(validatePhotoFile(file({ size: MAX_PHOTO_BYTES })), null);
  assert.match(validatePhotoFile(null), /choose a photo/);
});

test('partnerPhotoFilename namespaces every object to its authenticated owner', () => {
  assert.equal(
    partnerPhotoFilename('My Head Shot (2024).JPEG', USER_ID, 1700000000000, 0.5),
    `${USER_ID}/partner-1700000000000-i-My-Head-Shot-2024.jpeg`,
  );
  assert.equal(partnerPhotoFilename('headshot.jpg', null), null);
});

test('partnerPhotoFilename produces a traversal-safe filename even for hostile input', () => {
  const path = partnerPhotoFilename('../../!!!.png', USER_ID, 1, 0.1);
  assert.match(path, new RegExp(`^${USER_ID}/partner-1-[a-z0-9]+-photo\\.png$`));
  assert.equal(path.includes('..'), false);
});

function fakeSupabase({ uploadError = null, user = { id: USER_ID }, authError = null } = {}) {
  const calls = {};
  return {
    calls,
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    storage: {
      from(bucket) {
        calls.bucket = bucket;
        return {
          upload(path, body, options) {
            calls.upload = { path, body, options };
            return Promise.resolve({ error: uploadError });
          },
        };
      },
    },
  };
}

test('uploadPartnerPhoto stores a private owner path instead of a public URL', async () => {
  const supabase = fakeSupabase();
  const result = await uploadPartnerPhoto(supabase, file());

  assert.equal(result.error, null);
  assert.match(result.path, new RegExp(`^${USER_ID}/partner-`));
  assert.equal(supabase.calls.bucket, PHOTO_BUCKET);
  assert.equal(supabase.calls.upload.options.contentType, 'image/jpeg');
  assert.equal(result.url, undefined);
});

test('uploadPartnerPhoto validates and authenticates before it uploads anything', async () => {
  const invalid = await uploadPartnerPhoto(fakeSupabase(), file({ type: 'image/gif' }));
  assert.equal(invalid.path, null);
  assert.match(invalid.error, /JPG, PNG or WebP/);

  const noUser = await uploadPartnerPhoto(fakeSupabase({ user: null }), file());
  assert.equal(noUser.path, null);
  assert.match(noUser.error, /sign in again/);
});

test('uploadPartnerPhoto reports a storage failure in words the partner can act on', async () => {
  const result = await uploadPartnerPhoto(fakeSupabase({ uploadError: new Error('boom') }), file());
  assert.equal(result.path, null);
  assert.match(result.error, /Please try again/);
});

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

const file = (overrides = {}) => ({
  name: 'headshot.jpg',
  type: 'image/jpeg',
  size: 1024,
  ...overrides,
});

test('validatePhotoFile accepts the three types the bucket serves', () => {
  for (const type of ACCEPTED_PHOTO_TYPES) {
    assert.equal(validatePhotoFile(file({ type })), null);
  }
});

test('validatePhotoFile rejects the wrong type, an oversized file and nothing at all', () => {
  assert.match(validatePhotoFile(file({ type: 'application/pdf' })), /JPG, PNG or WebP/);
  assert.match(validatePhotoFile(file({ size: MAX_PHOTO_BYTES + 1 })), /over 5MB/);
  assert.equal(validatePhotoFile(file({ size: MAX_PHOTO_BYTES })), null);
  assert.match(validatePhotoFile(null), /choose a photo/);
});

// Bucket keys are flat and public, so two partners uploading "photo.jpg" at
// once must not land on the same object.
test('partnerPhotoFilename tames the original name and keeps the extension', () => {
  assert.equal(
    partnerPhotoFilename('My Head Shot (2024).JPEG', 1700000000000, 0.5),
    'partner-1700000000000-i-My-Head-Shot-2024.jpeg'
  );
});

test('partnerPhotoFilename falls back when there is nothing usable to work from', () => {
  assert.match(partnerPhotoFilename(''), /^partner-\d+-[a-z0-9]*-photo\.jpg$/);
  assert.match(partnerPhotoFilename(undefined), /^partner-\d+-[a-z0-9]*-photo\.jpg$/);
  // A name that is entirely punctuation still has to produce a valid key.
  assert.match(partnerPhotoFilename('!!!.png'), /-photo\.png$/);
});

function fakeSupabase({ uploadError = null, publicUrl = 'https://cdn.example/photo.jpg' } = {}) {
  const calls = {};
  return {
    calls,
    storage: {
      from(bucket) {
        calls.bucket = bucket;
        return {
          upload(path, body, options) {
            calls.upload = { path, body, options };
            return Promise.resolve({ error: uploadError });
          },
          getPublicUrl(path) {
            calls.publicUrlPath = path;
            return { data: publicUrl ? { publicUrl } : null };
          },
        };
      },
    },
  };
}

test('uploadPartnerPhoto stores in the shared photo bucket and returns the public URL', async () => {
  const supabase = fakeSupabase();
  const result = await uploadPartnerPhoto(supabase, file());

  assert.deepEqual(result, { url: 'https://cdn.example/photo.jpg', error: null });
  assert.equal(supabase.calls.bucket, PHOTO_BUCKET);
  assert.equal(supabase.calls.upload.options.contentType, 'image/jpeg');
  // The URL handed back must describe the object that was actually written.
  assert.equal(supabase.calls.publicUrlPath, supabase.calls.upload.path);
});

test('uploadPartnerPhoto validates before it uploads anything', async () => {
  const supabase = fakeSupabase();
  const result = await uploadPartnerPhoto(supabase, file({ type: 'image/gif' }));

  assert.equal(result.url, null);
  assert.match(result.error, /JPG, PNG or WebP/);
  assert.equal(supabase.calls.upload, undefined);
});

test('uploadPartnerPhoto reports a storage failure in words the partner can act on', async () => {
  const result = await uploadPartnerPhoto(fakeSupabase({ uploadError: new Error('boom') }), file());
  assert.equal(result.url, null);
  assert.match(result.error, /Please try again/);
});

test('uploadPartnerPhoto does not hand back a half-finished upload', async () => {
  const result = await uploadPartnerPhoto(fakeSupabase({ publicUrl: null }), file());
  assert.equal(result.url, null);
  assert.match(result.error, /Please try again/);
});

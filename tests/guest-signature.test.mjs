import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUEST_SIGNATURE_BUCKET,
  MAX_SIGNATURE_BYTES,
  MIN_SIGNATURE_BYTES,
  base64ByteLength,
  guestSignatureStoragePath,
  isGuestSignaturePath,
  parseSignatureDataUrl,
} from '../lib/guest-signature.js';

// The real PNG magic number, base64-encoded, padded out to a given decoded size.
function signatureOfBytes(bytes) {
  const base64Length = Math.ceil(bytes / 3) * 4;
  return `data:image/png;base64,iVBORw0KGgo${'A'.repeat(base64Length - 11)}`;
}

const SIGNATURE = signatureOfBytes(2048);
const PROFILE_ID = '11111111-2222-3333-4444-555555555555';
const OBJECT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('base64ByteLength measures the payload without decoding it', () => {
  assert.equal(base64ByteLength('AAAA'), 3);
  assert.equal(base64ByteLength('AAA='), 2);
  assert.equal(base64ByteLength('AA=='), 1);
  assert.equal(base64ByteLength(''), 0);
  // A length that is not a multiple of 4 is not base64 at all.
  assert.equal(base64ByteLength('AAAAA'), 0);
  assert.equal(base64ByteLength(null), 0);
});

test('a canvas PNG data URL parses into the bytes the route uploads', () => {
  const result = parseSignatureDataUrl(SIGNATURE);
  assert.equal(result.valid, true);
  assert.ok(result.base64.startsWith('iVBORw0KGgo'));
  assert.equal(result.bytes, 2049);
  // The base64 the parser hands back has to survive an actual decode, because
  // the route feeds it straight to Buffer.from(..., 'base64').
  assert.equal(Buffer.from(result.base64, 'base64').length, result.bytes);
});

test('an unsigned pad is refused with a message the door attendant can act on', () => {
  for (const empty of ['', '   ', null, undefined, 42]) {
    const result = parseSignatureDataUrl(empty);
    assert.equal(result.valid, false);
    assert.match(result.error, /sign/i);
  }
});

// The kiosk only ever sends canvas.toDataURL('image/png'). Anything else
// reaching this parser is a stale bundle or someone posting by hand, and it
// must not end up in the consent archive.
test('only a real PNG data URL is accepted', () => {
  const rejected = [
    'https://example.com/signature.png',
    'data:text/html;base64,PHNjcmlwdD4=',
    // Correct MIME label, but the bytes are a JPEG.
    `data:image/png;base64,/9j/4AAQSkZJRg${'A'.repeat(330)}`,
    // Correct MIME label and correct magic number, but not valid base64.
    `data:image/png;base64,iVBORw0KGgo${'A'.repeat(332)}!`,
    `data:image/jpeg;base64,iVBORw0KGgo${'A'.repeat(333)}`,
  ];
  for (const value of rejected) {
    assert.equal(parseSignatureDataUrl(value).valid, false, `${value.slice(0, 40)} should be rejected`);
  }
});

test('signatures outside the size bounds are refused before they reach storage', () => {
  assert.equal(parseSignatureDataUrl(signatureOfBytes(MIN_SIGNATURE_BYTES - 64)).valid, false);
  assert.equal(parseSignatureDataUrl(signatureOfBytes(MIN_SIGNATURE_BYTES + 64)).valid, true);

  assert.equal(parseSignatureDataUrl(signatureOfBytes(MAX_SIGNATURE_BYTES - 64)).valid, true);
  const tooBig = parseSignatureDataUrl(signatureOfBytes(MAX_SIGNATURE_BYTES + 1024));
  assert.equal(tooBig.valid, false);
  assert.match(tooBig.error, /too large/i);
});

test('signatures are filed under the profile they belong to', () => {
  assert.equal(
    guestSignatureStoragePath(PROFILE_ID, OBJECT_ID),
    `${PROFILE_ID}/${OBJECT_ID}.png`,
  );
  assert.equal(isGuestSignaturePath(guestSignatureStoragePath(PROFILE_ID, OBJECT_ID)), true);
});

// The path guard is what stands between a corrupted signature_path column and
// a storage read for some other object, so it has to reject traversal and
// anything that is not this bucket's exact two-uuid layout.
test('isGuestSignaturePath refuses anything but <uuid>/<uuid>.png', () => {
  const rejected = [
    '',
    null,
    `${PROFILE_ID}.png`,
    `${PROFILE_ID}/${OBJECT_ID}`,
    `${PROFILE_ID}/${OBJECT_ID}.pdf`,
    `${PROFILE_ID}/../../secrets/${OBJECT_ID}.png`,
    `${PROFILE_ID}/${OBJECT_ID}.png/extra`,
    `not-a-uuid/${OBJECT_ID}.png`,
    `${PROFILE_ID}/not-a-uuid.png`,
  ];
  for (const value of rejected) {
    assert.equal(isGuestSignaturePath(value), false, `${value} should be rejected`);
  }
});

test('the signature bucket is namespaced away from the public photo bucket', () => {
  assert.equal(GUEST_SIGNATURE_BUCKET, 'guest-signatures');
  assert.notEqual(GUEST_SIGNATURE_BUCKET, 'member-photos');
});

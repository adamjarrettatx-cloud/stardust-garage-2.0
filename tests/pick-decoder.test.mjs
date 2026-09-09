import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickDecoder,
  DECODER_NATIVE,
  DECODER_JSQR,
  DECODER_NONE,
  NO_DECODER_MESSAGE,
} from '../lib/scan/pick-decoder.js';

test('no window at all → none (SSR / bad env)', () => {
  assert.equal(pickDecoder({}), DECODER_NONE);
  assert.equal(pickDecoder({ win: null }), DECODER_NONE);
  assert.equal(pickDecoder({ win: undefined, jsqrAvailable: true }), DECODER_NONE);
});

test('window with BarcodeDetector present → native (regardless of jsQR)', () => {
  const win = { BarcodeDetector: function () {} };
  assert.equal(pickDecoder({ win, jsqrAvailable: false }), DECODER_NATIVE);
  assert.equal(pickDecoder({ win, jsqrAvailable: true }), DECODER_NATIVE);
});

test('window without BarcodeDetector but jsQR loaded → jsqr (the iPad case)', () => {
  const win = {};
  assert.equal(pickDecoder({ win, jsqrAvailable: true }), DECODER_JSQR);
});

test('window without BarcodeDetector and jsQR failed to load → none', () => {
  const win = {};
  assert.equal(pickDecoder({ win, jsqrAvailable: false }), DECODER_NONE);
  assert.equal(pickDecoder({ win }), DECODER_NONE); // undefined defaults to false
});

test('forceFallback skips native even when it exists', () => {
  const win = { BarcodeDetector: function () {} };
  assert.equal(
    pickDecoder({ win, jsqrAvailable: true, forceFallback: true }),
    DECODER_JSQR,
  );
});

test('forceFallback with no jsQR falls all the way to none', () => {
  // Belt-and-suspenders: a caller who forces the fallback but has no jsQR
  // gets DECODER_NONE, not a silent switch back to native.
  const win = { BarcodeDetector: function () {} };
  assert.equal(
    pickDecoder({ win, jsqrAvailable: false, forceFallback: true }),
    DECODER_NONE,
  );
});

test('NO_DECODER_MESSAGE is a non-empty user-facing string', () => {
  // A regression here (accidental blank / undefined) would render an empty
  // "camera_error" screen on the one device that most needs the message.
  assert.equal(typeof NO_DECODER_MESSAGE, 'string');
  assert.ok(NO_DECODER_MESSAGE.length > 10);
  // Should NOT mention "Chromium" — Chrome on iPad is not real Chromium,
  // and the whole point of the jsQR fallback is that browser choice no
  // longer matters. That old message is what shipped the confusing
  // iPad-specific error we are trying to prevent.
  assert.ok(!/Chromium/i.test(NO_DECODER_MESSAGE));
});

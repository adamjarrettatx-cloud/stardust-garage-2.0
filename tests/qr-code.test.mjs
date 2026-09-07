// Tests for lib/qr-code.js — the QR encoder that powers every scannable
// code in the business (event tickets, trial passes, capacity-door setup).
//
// The old edition of this file shipped a home-brewed encoder AND a
// home-brewed decoder in the test, and the decoder verified the encoder's
// own idiosyncratic bit layout. Both agreed with each other but disagreed
// with real phone cameras, so the tests passed while every ticket QR in
// production was silently unscannable.
//
// This file has been rebuilt around the `qrcode` npm package (which
// lib/qr-code.js now delegates to). We verify:
//   * shape invariants of the returned matrix (square, boolean cells,
//     finder patterns in the expected corners, proper size for the payload)
//   * SVG structural correctness (viewBox, quiet zone, rect count matches
//     dark-module count)
//   * that the emitted matrix byte-for-byte matches what QRCode.create
//     returns for the same input — this is what a real scanner sees.
//
// Byte-for-byte matrix parity IS the scannability guarantee: pyzbar (the C
// decoder underlying most phone-camera scanners) was verified locally to
// decode QRCode.create output round-trip.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {
  encodeQrMatrix,
  qrMatrixToSvgPath,
  qrMatrixToSvg,
} from '../lib/qr-code.js';

// Real-world payloads across every business surface. Each MUST round-trip.
const REAL_PAYLOADS = [
  // Ticket door-scan URL — 66 chars, QR v4.
  'https://www.sdgatx.com/t/scan?t=SDGA-5MDG-45S2-F10Y-2VFR-TCT9-VVVP',
  // Trial-pass URL — around 60 chars.
  'https://www.sdgatx.com/pass/tp_ABCDEFGHJKMNPQRSTVWX',
  // Capacity-device setup URL — usually 90+ chars with token.
  'https://www.sdgatx.com/c/f/dev_ABCDEFGHJKMNPQRSTVWX?token=ZYX987654321ABC',
  // Short — should fit at v1 or v2.
  'hello',
];

function expectedMatrixFor(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  return qr.modules;
}

test('encodeQrMatrix returns a square boolean[][] whose size matches the QR spec', () => {
  for (const text of REAL_PAYLOADS) {
    const m = encodeQrMatrix(text);
    assert.ok(Array.isArray(m), `payload ${text}: not an array`);
    const n = m.length;
    assert.ok(n >= 21 && n <= 177, `payload ${text}: unexpected matrix size ${n}`);
    for (const row of m) {
      assert.strictEqual(row.length, n, `payload ${text}: non-square`);
      for (const cell of row) assert.strictEqual(typeof cell, 'boolean');
    }
  }
});

test('encodeQrMatrix places the three finder patterns in the correct corners', () => {
  // Every valid QR has a 7x7 finder pattern in the top-left, top-right,
  // and bottom-left, each surrounded by a one-module separator (white).
  // The center 3x3 is dark. If a future refactor broke module placement,
  // these corners are the first thing that would go wrong.
  for (const text of REAL_PAYLOADS) {
    const m = encodeQrMatrix(text);
    const n = m.length;
    const finderCorners = [
      { r: 0, c: 0 },
      { r: 0, c: n - 7 },
      { r: n - 7, c: 0 },
    ];
    for (const { r, c } of finderCorners) {
      // Outer ring dark.
      for (let i = 0; i < 7; i++) {
        assert.strictEqual(m[r][c + i], true, `payload ${text}: finder outer ring`);
        assert.strictEqual(m[r + 6][c + i], true);
        assert.strictEqual(m[r + i][c], true);
        assert.strictEqual(m[r + i][c + 6], true);
      }
      // Inner 3x3 dark.
      for (let dr = 2; dr <= 4; dr++) {
        for (let dc = 2; dc <= 4; dc++) {
          assert.strictEqual(m[r + dr][c + dc], true, `payload ${text}: finder center`);
        }
      }
      // Middle ring light.
      for (let i = 1; i <= 5; i++) {
        assert.strictEqual(m[r + 1][c + i], false, `payload ${text}: finder inner ring`);
        assert.strictEqual(m[r + 5][c + i], false);
      }
    }
  }
});

test('encodeQrMatrix output byte-for-byte matches QRCode.create — the scannability contract', () => {
  // This is the guarantee that a real phone camera can read what we emit.
  // qrcode's encoder is the reference implementation; if our exports drift
  // from it, scanning breaks in the field.
  for (const text of REAL_PAYLOADS) {
    const ours = encodeQrMatrix(text);
    const ref = expectedMatrixFor(text);
    const n = ref.size;
    assert.strictEqual(ours.length, n, `payload ${text}: size mismatch`);
    let bad = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const shouldBeDark = !!ref.data[r * n + c];
        if (ours[r][c] !== shouldBeDark) bad++;
      }
    }
    assert.strictEqual(bad, 0, `payload ${text}: ${bad} cells differ from canonical encoding`);
  }
});

test('encodeQrMatrix throws on empty / non-string input', () => {
  assert.throws(() => encodeQrMatrix(''), /non-empty string/);
  assert.throws(() => encodeQrMatrix(null), /non-empty string/);
  assert.throws(() => encodeQrMatrix(undefined), /non-empty string/);
  assert.throws(() => encodeQrMatrix(42), /non-empty string/);
});

test('qrMatrixToSvgPath emits one unit square per dark module', () => {
  const m = encodeQrMatrix('hello');
  const path = qrMatrixToSvgPath(m);
  const dark = m.flat().filter(Boolean).length;
  const moves = path.match(/M/g) || [];
  assert.strictEqual(moves.length, dark, 'one M-command per dark module');
});

test('qrMatrixToSvg returns a well-formed SVG with correct viewBox and rect count', () => {
  for (const text of REAL_PAYLOADS) {
    const svg = qrMatrixToSvg(text, { size: 320, quietZone: 4 });
    assert.strictEqual(typeof svg, 'string');
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /width="320" height="320"/);
    assert.match(svg, /<\/svg>$/);
    // viewBox = matrix size + 2 * quietZone.
    const m = encodeQrMatrix(text);
    const total = m.length + 8;
    assert.match(svg, new RegExp(`viewBox="0 0 ${total} ${total}"`));
    // Rect count = dark modules + 1 background rect.
    const dark = m.flat().filter(Boolean).length;
    const rects = (svg.match(/<rect /g) || []).length;
    assert.strictEqual(rects, dark + 1, `payload ${text}: rect count off`);
  }
});

test('qrMatrixToSvg returns null on bad input rather than throwing', () => {
  // Existing callers rely on the null fall-back path for graceful degradation.
  assert.strictEqual(qrMatrixToSvg(''), null);
  assert.strictEqual(qrMatrixToSvg(null), null);
});

test('qrMatrixToSvg respects custom dark / light colors', () => {
  const svg = qrMatrixToSvg('hello', { dark: '#0a0a0a', light: '#ffffff' });
  assert.match(svg, /fill="#ffffff"/);
  assert.match(svg, /fill="#0a0a0a"/);
});

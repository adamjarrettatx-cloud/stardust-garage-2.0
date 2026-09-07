// Regression test guarding the QR rendering pipeline used by
// /account/tickets, /tickets/status, and the confirmation email.
//
// Previously lib/tickets/qr.js#renderTicketQrSvg did:
//   const matrix = encodeQrMatrix(url);
//   return qrMatrixToSvg(matrix, ...);
// But qrMatrixToSvg's first arg is the RAW STRING and it encodes internally.
// Passing the pre-encoded boolean[][] made the inner encodeQrMatrix throw
// 'text must be a non-empty string' (caught) and the function silently
// returned null. That null was fed to React's dangerouslySetInnerHTML and
// rendered as literal characters instead of a QR image, so no ticket buyer
// could actually check in at the door.
//
// This test asserts that qrMatrixToSvg — called correctly, with a STRING —
// produces a real inline <svg>. If a future refactor of lib/qr-code.js
// changes the return shape or accepts a pre-encoded matrix again, this
// test catches it before it ships. It does NOT import lib/tickets/qr.js
// because that file uses the '@/lib/*' Next path alias which isn't
// resolvable outside a Next build; the shape guarantee it depends on
// (qrMatrixToSvg(text, opts) -> string) is what we lock in here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrixToSvg, encodeQrMatrix } from '../lib/qr-code.js';

const url = 'https://www.sdgatx.com/t/scan?t=SDGA-ABCD-EFGH-JKMN-PQRS-TVWX-YZ01';

test('qrMatrixToSvg(text, opts) returns a real inline <svg> string', () => {
  const svg = qrMatrixToSvg(url, { size: 320, quietZone: 4 });
  assert.strictEqual(typeof svg, 'string');
  assert.ok(svg.length > 200, 'svg length ' + svg.length);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<path d="/);
  assert.match(svg, /<\/svg>$/);
});

test('qrMatrixToSvg returns null (not a matrix, not [object Object]) when given a pre-encoded matrix — proving the old bug shape', () => {
  const matrix = encodeQrMatrix(url);
  assert.ok(Array.isArray(matrix));
  // If someone accidentally passes the matrix again, we must get null so a
  // downstream `typeof svg === 'string'` check can fall back cleanly instead
  // of stringifying garbage into innerHTML.
  const bad = qrMatrixToSvg(matrix, { size: 320, quietZone: 4 });
  assert.strictEqual(bad, null);
});

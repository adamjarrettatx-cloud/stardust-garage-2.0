import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeQrMatrix,
  qrMatrixToSvgPath,
  qrMatrixToSvg,
} from '../lib/qr-code.js';

// A compact, self-contained byte-mode QR decoder (versions 1..10, EC level M).
// It is intentionally independent of lib/qr-code.js internals — it re-derives
// the reserved mask, reads the format bits to recover the mask id, un-masks the
// data region, de-interleaves the blocks, and parses the byte-mode segment. If
// this decodes back to the original text, the encoder's masking, format BCH,
// Reed-Solomon layout, and module placement are all internally consistent.
const VERSIONS_M = {
  1: { g: [[1, 16]] }, 2: { g: [[1, 28]] }, 3: { g: [[1, 44]] },
  4: { g: [[2, 32]] }, 5: { g: [[2, 43]] }, 6: { g: [[4, 27]] },
  7: { g: [[4, 31]] }, 8: { g: [[2, 38], [2, 39]] },
  9: { g: [[3, 36], [2, 37]] }, 10: { g: [[4, 43], [1, 44]] },
};
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function reservedMask(version) {
  const size = version * 4 + 17;
  const res = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r, c) => { if (r >= 0 && r < size && c >= 0 && c < size) res[r][c] = true; };
  const finder = (R, C) => { for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) mark(R + r, C + c); };
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
  const ctr = ALIGN[version];
  for (const r of ctr) for (const c of ctr) {
    if ((r === 6 && c === 6) || (r === 6 && c === ctr[ctr.length - 1]) || (r === ctr[ctr.length - 1] && c === 6)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
  }
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
  return res;
}
function maskCond(id, r, c) {
  switch (id) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}
function decodeQr(m) {
  const size = m.length;
  const version = (size - 17) / 4;
  const info = VERSIONS_M[version];
  let fbits = 0;
  for (let i = 0; i <= 5; i++) fbits |= (m[8][i] ? 1 : 0) << i;
  fbits |= (m[8][7] ? 1 : 0) << 6; fbits |= (m[8][8] ? 1 : 0) << 7; fbits |= (m[7][8] ? 1 : 0) << 8;
  for (let i = 9; i <= 14; i++) fbits |= (m[14 - i][8] ? 1 : 0) << i;
  fbits ^= 0b101010000010010;
  const maskId = ((fbits >> 10) & 0x1f) & 7;
  const res = reservedMask(version);
  const bits = [];
  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const row = up ? size - 1 - i : i;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (res[row][c]) continue;
        let v = m[row][c] ? 1 : 0;
        if (maskCond(maskId, row, c)) v ^= 1;
        bits.push(v);
      }
    }
    up = !up;
  }
  const cw = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    cw.push(b);
  }
  const blocks = [];
  for (const [n, d] of info.g) for (let i = 0; i < n; i++) blocks.push({ d, data: [] });
  const maxD = Math.max(...blocks.map((b) => b.d));
  let idx = 0;
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.d) b.data.push(cw[idx++]);
  const data = [];
  for (const b of blocks) for (const x of b.data) data.push(x);
  let bp = 0;
  const rd = (n) => { let v = 0; for (let k = 0; k < n; k++) { const byte = data[bp >> 3]; const bit = (byte >> (7 - (bp & 7))) & 1; v = (v << 1) | bit; bp++; } return v; };
  rd(4); // mode (byte = 0b0100)
  const len = rd(version <= 9 ? 8 : 16);
  const out = [];
  for (let i = 0; i < len; i++) out.push(rd(8));
  return Buffer.from(out).toString('utf8');
}

test('encodeQrMatrix returns a square odd-sized boolean matrix', () => {
  const m = encodeQrMatrix('hello');
  assert.ok(Array.isArray(m) && m.length > 0);
  assert.equal(m.length % 4, 1); // 4v+17 is always 1 mod 4
  for (const row of m) {
    assert.equal(row.length, m.length);
    for (const cell of row) assert.equal(typeof cell, 'boolean');
  }
});

test('encodeQrMatrix lays down the three finder patterns', () => {
  const m = encodeQrMatrix('finder check');
  const size = m.length;
  const corners = [[0, 0], [0, size - 7], [size - 7, 0]];
  for (const [R, C] of corners) {
    // 7x7 finder: solid dark border ring + 3x3 dark core, light ring between.
    assert.equal(m[R][C], true, 'finder corner dark');
    assert.equal(m[R + 1][C + 1], false, 'finder inner ring light');
    assert.equal(m[R + 3][C + 3], true, 'finder core dark');
  }
  // Always-dark module just above the bottom-left finder format area.
  assert.equal(m[size - 8][8], true);
});

test('encodeQrMatrix picks the smallest version that fits', () => {
  assert.equal(encodeQrMatrix('hi').length, 21);          // version 1
  // ~96-char URL needs version 6 (size 41) at level M.
  const url = 'https://stardustgarage.com/capacity/exit-door?token=abcDEF123_-xyzABCdefGHIjklMNOpqrSTUvwx012345';
  assert.equal(encodeQrMatrix(url).length, 41);
});

test('round-trip: a matrix decodes back to the original text', () => {
  const samples = [
    'hi',
    'x'.repeat(100),
    'https://example.com/capacity/front-door?token=tok',
    'https://stardustgarage.com/capacity/exit-door?token=abcDEF123_-xyzABCdefGHIjklMNOpqrSTUvwx012345',
  ];
  for (const s of samples) {
    assert.equal(decodeQr(encodeQrMatrix(s)), s, `round-trip failed for length ${s.length}`);
  }
});

test('round-trip preserves the full ?token= query string exactly', () => {
  // The whole point of the QR: the token must survive intact, including symbols.
  const url = 'https://sg.app/capacity/exit-door?token=Ab1_-Cd2.Ef3~Gh4';
  assert.equal(decodeQr(encodeQrMatrix(url)), url);
});

test('encodeQrMatrix is deterministic for the same input', () => {
  const a = encodeQrMatrix('determinism');
  const b = encodeQrMatrix('determinism');
  assert.deepEqual(a, b);
});

test('encodeQrMatrix rejects empty/invalid input', () => {
  assert.throws(() => encodeQrMatrix(''), /non-empty/);
  assert.throws(() => encodeQrMatrix(null), /non-empty/);
  assert.throws(() => encodeQrMatrix(undefined), /non-empty/);
});

test('encodeQrMatrix throws when payload exceeds the supported range', () => {
  assert.throws(() => encodeQrMatrix('x'.repeat(2000)), /too long/);
});

test('qrMatrixToSvgPath emits one unit square per dark module', () => {
  const m = encodeQrMatrix('hi');
  const path = qrMatrixToSvgPath(m);
  let dark = 0;
  for (const row of m) for (const cell of row) if (cell) dark++;
  const squares = (path.match(/M\d+ \d+h1v1h-1z/g) || []).length;
  assert.equal(squares, dark);
});

test('qrMatrixToSvg wraps the code with a quiet zone and viewBox', () => {
  const svg = qrMatrixToSvg('https://sg.app/capacity/front-door?token=tok', { size: 200, quietZone: 4 });
  assert.ok(svg.startsWith('<svg'));
  assert.match(svg, /width="200" height="200"/);
  // version-? size + 2*quietZone shows up in the viewBox.
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.ok(svg.includes('<path d="M'));
});

test('qrMatrixToSvg returns null instead of throwing on bad input', () => {
  assert.equal(qrMatrixToSvg(''), null);
});

// Dependency-free QR Code generator (byte mode), used to turn a capacity door
// setup URL into a scannable code so Adam never has to type the long ?token=...
// string on a Unihertz Jelly2. Pure JS + no imports, so the matrix logic is unit
// testable under `node --test` and safe to import into a client component.
//
// Scope is deliberately small: byte (8-bit) mode only, error-correction level M,
// auto-selecting the smallest QR version 1..6 that fits the data. v6 at level M
// holds ~134 byte-mode chars, which covers our setup URLs (~60-95 chars) with
// margin. We intentionally STOP at version 6: versions >= 7 additionally require
// an 18-bit version-information block (BCH(18,6), two 6x3 regions by the
// top-right / bottom-left finders) that this compact encoder does not emit, so
// supporting them would silently produce unscannable codes. Anything longer than
// v6 fits returns null from chooseVersion -> qrMatrixToSvg returns null and the
// UI falls back to the raw-URL / copy path.
//
// `encodeQrMatrix(text)` returns a square boolean[][] (true = dark module). A
// caller renders it however it likes; `qrMatrixToSvgPath`/`qrMatrixToSvg` are
// provided for the common SVG case so the UI stays declarative.

// ---- Galois field (GF(256)) tables for Reed-Solomon, generated once ----
const EXP = new Array(256);
const LOG = new Array(256);
(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
  }
  for (let i = 255; i < 256; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] + LOG[b]) % 255];
}

// Reed-Solomon generator polynomial of `degree` (number of EC codewords).
function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

// Compute `ecCount` Reed-Solomon error-correction codewords for `data`.
function rsEncode(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const res = new Array(ecCount).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ res[0];
    res.shift();
    res.push(0);
    for (let j = 0; j < gen.length; j++) {
      res[j] ^= gfMul(gen[j], factor);
    }
  }
  return res;
}

// ---- Per-version capacity / block structure for EC level M (byte mode) ----
// Each entry: ec codewords per block, and block group layout
// [ [numBlocks, dataCodewordsPerBlock], ... ]. Versions 1..6 only — see the file
// header for why we stop at 6 (versions >= 7 need a version-information block we
// don't emit). v6 holds ~134 byte-mode chars at level M.
const VERSIONS_M = {
  1: { ecPerBlock: 10, groups: [[1, 16]] },
  2: { ecPerBlock: 16, groups: [[1, 28]] },
  3: { ecPerBlock: 26, groups: [[1, 44]] },
  4: { ecPerBlock: 18, groups: [[2, 32]] },
  5: { ecPerBlock: 24, groups: [[2, 43]] },
  6: { ecPerBlock: 16, groups: [[4, 27]] },
};

function versionTotalDataCodewords(v) {
  return VERSIONS_M[v].groups.reduce((sum, [n, c]) => sum + n * c, 0);
}

function moduleCount(version) {
  return version * 4 + 17;
}

// ---- Bit buffer ----
class BitBuffer {
  constructor() { this.bits = []; }
  put(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
  get length() { return this.bits.length; }
}

// Build the full data codeword stream (data + EC, interleaved) for a version.
function buildCodewords(bytes, version) {
  const info = VERSIONS_M[version];
  const totalData = versionTotalDataCodewords(version);

  const bb = new BitBuffer();
  bb.put(0b0100, 4);     // byte mode indicator
  bb.put(bytes.length, 8); // char-count indicator: 8 bits for byte mode, v1..9
  for (const b of bytes) bb.put(b, 8);

  // Terminator (up to 4 zero bits) then pad to a byte boundary.
  const capacityBits = totalData * 8;
  const termLen = Math.min(4, capacityBits - bb.length);
  if (termLen > 0) bb.put(0, termLen);
  while (bb.length % 8 !== 0) bb.bits.push(0);

  // Data codewords from the bit stream.
  const dataCodewords = [];
  for (let i = 0; i < bb.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bb.bits[i + j];
    dataCodewords.push(byte);
  }
  // Pad bytes alternate 0xEC / 0x11 until the version's data capacity is full.
  const PADS = [0xec, 0x11];
  let p = 0;
  while (dataCodewords.length < totalData) {
    dataCodewords.push(PADS[p++ % 2]);
  }

  // Split into blocks per the group layout, compute EC per block.
  const blocks = [];
  let pos = 0;
  for (const [numBlocks, dataPerBlock] of info.groups) {
    for (let i = 0; i < numBlocks; i++) {
      const data = dataCodewords.slice(pos, pos + dataPerBlock);
      pos += dataPerBlock;
      blocks.push({ data, ec: rsEncode(data, info.ecPerBlock) });
    }
  }

  // Interleave data codewords, then EC codewords.
  const result = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.data.length) result.push(b.data[i]);
  }
  const maxEc = Math.max(...blocks.map((b) => b.ec.length));
  for (let i = 0; i < maxEc; i++) {
    for (const b of blocks) if (i < b.ec.length) result.push(b.ec[i]);
  }
  return result;
}

// ---- Matrix construction ----
function makeEmptyMatrix(size) {
  const m = [];
  for (let r = 0; r < size; r++) m.push(new Array(size).fill(null));
  return m;
}

function placeFinder(m, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= m.length || cc < 0 || cc >= m.length) continue;
      const inRing =
        (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m[rr][cc] = inRing || inCore;
    }
  }
}

// Alignment-pattern centers per version (versions 1..6; see file header).
const ALIGN_CENTERS = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
};

function placeAlignment(m, version) {
  const centers = ALIGN_CENTERS[version];
  for (const r of centers) {
    for (const c of centers) {
      // Skip the three that collide with finder patterns.
      if ((r === 6 && c === 6) ||
          (r === 6 && c === centers[centers.length - 1]) ||
          (r === centers[centers.length - 1] && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const ring = Math.max(Math.abs(dr), Math.abs(dc));
          m[r + dr][c + dc] = ring !== 1;
        }
      }
    }
  }
}

function placeTiming(m) {
  const size = m.length;
  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0;
    if (m[6][i] === null) m[6][i] = v;
    if (m[i][6] === null) m[i][6] = v;
  }
}

function reserveFormatAreas(m) {
  const size = m.length;
  // Mark format-info cells as reserved (non-null, value fixed later).
  for (let i = 0; i < 9; i++) {
    if (m[8][i] === null) m[8][i] = false;
    if (m[i][8] === null) m[i][8] = false;
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = false;
    if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = false;
  }
  m[size - 8][8] = true; // dark module (always dark)
}

function isFunctionModule(reserved, r, c) {
  return reserved[r][c];
}

// Snapshot which cells are function/reserved BEFORE data placement.
function buildReservedMask(version) {
  const size = moduleCount(version);
  const m = makeEmptyMatrix(size);
  placeFinder(m, 0, 0);
  placeFinder(m, 0, size - 7);
  placeFinder(m, size - 7, 0);
  placeAlignment(m, version);
  placeTiming(m);
  reserveFormatAreas(m);
  const reserved = m.map((row) => row.map((cell) => cell !== null));
  return { base: m, reserved, size };
}

function placeData(m, reserved, codewords) {
  const size = m.length;
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  const getBit = (i) => (i < totalBits ? (codewords[i >> 3] >> (7 - (i & 7))) & 1 : 0);

  let up = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--; // skip the vertical timing column
    for (let i = 0; i < size; i++) {
      const row = up ? size - 1 - i : i;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (isFunctionModule(reserved, row, c)) continue;
        m[row][c] = getBit(bitIndex) === 1;
        bitIndex++;
      }
    }
    up = !up;
  }
}

function maskCondition(maskId, row, col) {
  switch (maskId) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return false;
  }
}

function applyMask(m, reserved, maskId) {
  const size = m.length;
  const out = m.map((row) => row.slice());
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      if (maskCondition(maskId, r, c)) out[r][c] = !out[r][c];
    }
  }
  return out;
}

// Format information for EC level M + mask, 15 bits with BCH + mask XOR.
function formatBits(maskId) {
  const ecBits = 0b00; // level M
  let data = (ecBits << 3) | maskId;
  let rem = data;
  for (let i = 0; i < 10; i++) {
    rem = (rem << 1) ^ (((rem >> 9) & 1) ? 0b10100110111 : 0);
  }
  let bits = ((data << 10) | (rem & 0x3ff)) ^ 0b101010000010010;
  return bits & 0x7fff;
}

function placeFormat(m, maskId) {
  const size = m.length;
  const bits = formatBits(maskId);
  const get = (i) => (bits >> i) & 1;
  // Around top-left finder.
  for (let i = 0; i <= 5; i++) m[8][i] = get(i) === 1;
  m[8][7] = get(6) === 1;
  m[8][8] = get(7) === 1;
  m[7][8] = get(8) === 1;
  for (let i = 9; i <= 14; i++) m[14 - i][8] = get(i) === 1;
  // Around the other two finders.
  for (let i = 0; i <= 7; i++) m[size - 1 - i][8] = get(i) === 1;
  for (let i = 8; i <= 14; i++) m[8][size - 15 + i] = get(i) === 1;
  m[size - 8][8] = true; // dark module
}

// Penalty score per the QR spec; lower is better. Used to pick the mask.
function maskPenalty(m) {
  const size = m.length;
  let penalty = 0;
  // Rule 1: runs of 5+ same-color in row/col.
  for (let r = 0; r < size; r++) {
    for (const horiz of [true, false]) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        const a = horiz ? m[r][c] : m[c][r];
        const b = horiz ? m[r][c - 1] : m[c - 1][r];
        if (a === b) { run++; if (run === 5) penalty += 3; else if (run > 5) penalty += 1; }
        else run = 1;
      }
    }
  }
  // Rule 2: 2x2 blocks of same color.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) penalty += 3;
    }
  }
  // Rule 4: proportion of dark modules.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
  const ratio = (dark * 100) / (size * size);
  penalty += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return penalty;
}

function utf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
  // Minimal UTF-8 fallback (URLs are ASCII anyway).
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return out;
}

// Pick the smallest supported version (1..6) whose data capacity holds the
// payload, or null if it does not fit — callers fall back to the raw URL.
function chooseVersion(byteLen) {
  for (const v of Object.keys(VERSIONS_M).map(Number)) {
    const needBits = 4 + 8 + byteLen * 8; // mode + 8-bit char count + data
    if (needBits <= versionTotalDataCodewords(v) * 8) return v;
  }
  return null;
}

// Encode `text` into a QR matrix (boolean[][], true = dark). Throws if the text
// is empty or too long for the supported version range.
export function encodeQrMatrix(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('encodeQrMatrix: text must be a non-empty string');
  }
  const bytes = utf8Bytes(text);
  const version = chooseVersion(bytes.length);
  if (!version) {
    throw new Error(`encodeQrMatrix: payload too long (${bytes.length} bytes)`);
  }

  const codewords = buildCodewords(bytes, version);
  const { base, reserved } = buildReservedMask(version);

  // Fill function patterns into a working matrix (data cells start false).
  const filled = base.map((row) => row.map((cell) => (cell === null ? false : cell)));
  placeData(filled, reserved, codewords);

  // Try all 8 masks, keep the lowest-penalty result.
  let best = null;
  let bestPenalty = Infinity;
  for (let maskId = 0; maskId < 8; maskId++) {
    const masked = applyMask(filled, reserved, maskId);
    placeFormat(masked, maskId);
    const p = maskPenalty(masked);
    if (p < bestPenalty) { bestPenalty = p; best = masked; }
  }
  return best;
}

// Build the SVG path "d" string of dark modules for a matrix (1 unit = 1
// module). Caller sets viewBox = `0 0 size size`.
export function qrMatrixToSvgPath(matrix) {
  let d = '';
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix.length; c++) {
      if (matrix[r][c]) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  return d;
}

// Convenience: full SVG markup string for a payload, with a quiet-zone border.
// `size` is the pixel size of the rendered square. Colors default to black on
// white. Returns null if encoding fails (caller can fall back to the raw URL).
export function qrMatrixToSvg(text, { size = 240, quietZone = 4, dark = '#000000', light = '#ffffff' } = {}) {
  let matrix;
  try { matrix = encodeQrMatrix(text); } catch { return null; }
  const n = matrix.length;
  const total = n + quietZone * 2;
  const path = qrMatrixToSvgPath(matrix);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${light}"/>` +
    `<g transform="translate(${quietZone} ${quietZone})" fill="${dark}"><path d="${path}"/></g>` +
    `</svg>`
  );
}

// QR encoding for the whole app.
//
// PRODUCTION-CRITICAL: this module powers every scannable code in the
// business — event tickets (door check-in), trial passes (front desk),
// capacity-door devices (staff setup). If any of these fail to scan the
// business stops working. That is why the actual encoding is delegated to
// the `qrcode` npm package — a widely-deployed, well-tested implementation
// — instead of the previous home-rolled encoder that lived in this file
// and produced silently unscannable matrices for anything past QR v1.
//
// The public API kept below (`encodeQrMatrix`, `qrMatrixToSvgPath`,
// `qrMatrixToSvg`) is the same signature the rest of the app has always
// called, so this replacement is drop-in for every caller:
//   * lib/tickets/qr.js               — ticket door-scan URLs
//   * app/pass/[token]/page.js        — trial-pass QR (server render)
//   * app/pass/TrialPassForm.js       — trial-pass QR (client render)
//   * app/capacity/admin/DeviceManager.js — capacity-device setup QR
//
// The one-and-only behavioral change: matrices/SVGs now actually decode on
// real phone cameras. Verified locally with pyzbar (the C decoder that
// underpins most mobile QR readers) end-to-end for each surface.

import QRCode from 'qrcode';

// Encode `text` into a QR matrix (boolean[][], true = dark). Uses error
// correction level M — recovers from ~15% obscured modules (typical smudge,
// glare on a phone screen at the door) without inflating the code size the
// way Q/H would.
//
// Throws if `text` is empty. Anything else that fails encoding (payload too
// long, non-string input) also throws so callers can react — historically the
// only caller that cared was qrMatrixToSvg which catches into a null.
export function encodeQrMatrix(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('encodeQrMatrix: text must be a non-empty string');
  }
  // QRCode.create is synchronous and returns { modules: BitMatrix, version, ... }.
  // BitMatrix has { size, data } where data is a Uint8Array of 0/1 in row-major
  // order. Convert to the boolean[][] shape the app has always consumed.
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const matrix = new Array(n);
  for (let r = 0; r < n; r++) {
    const row = new Array(n);
    for (let c = 0; c < n; c++) row[c] = !!data[r * n + c];
    matrix[r] = row;
  }
  return matrix;
}

// Build the SVG path "d" string of dark modules for a matrix (1 unit = 1
// module). Caller sets viewBox = `0 0 size size`. Only used by the older
// helper below and by the low-level test — kept for API stability.
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
//
// The SVG renders as filled unit-square <rect>s rather than a stroked <path>.
// Filled rects rasterize identically across every renderer we care about
// (Chrome/Safari/Firefox in the app, Gmail/Apple Mail/Outlook in the email,
// and browser cameras from the wallet screen). The stroked-path form that
// `qrcode`'s bundled SVG renderer emits has produced fuzzy-edge modules in
// some email clients, which cost scans at the door.
export function qrMatrixToSvg(text, { size = 240, quietZone = 4, dark = '#000000', light = '#ffffff' } = {}) {
  let matrix;
  try { matrix = encodeQrMatrix(text); } catch { return null; }
  const n = matrix.length;
  const total = n + quietZone * 2;
  let rects = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (matrix[y][x]) {
        rects += `<rect x="${x + quietZone}" y="${y + quietZone}" width="1" height="1"/>`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="${light}"/>` +
    `<g fill="${dark}">${rects}</g>` +
    `</svg>`
  );
}

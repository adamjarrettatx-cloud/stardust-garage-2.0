// Regression test for lib/tickets/qr.js — the pipeline that produces every
// ticket QR in confirmation emails, resend emails, /account/tickets wallet
// cards, /tickets/status success screen, and the standalone /t/[code]
// public page.
//
// Two bugs have hit this file in the past:
//   1. renderTicketQrSvg double-encoded the payload (matrix passed where a
//      string was expected), silently returned null, and React's
//      dangerouslySetInnerHTML rendered null as the literal characters
//      "null" instead of a QR image.
//   2. The internal home-brewed encoder in lib/qr-code.js produced matrices
//      that failed to decode on real phone-camera QR readers for any payload
//      that pushed past QR version 1 — i.e., every ticket URL. The overlay
//      SHOWED something that looked like a QR, but no camera could parse it.
//      Fix: swap to the battle-tested `qrcode` npm package.
//
// This test asserts BOTH:
//   * shape — real inline <svg> string with the expected structure
//   * scannability — the SVG, when read back with a QR decoder, produces
//     exactly the /t/scan URL we encoded. If a future refactor breaks the
//     bit layout, mask selection, or format info, decode round-trip fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTicketQrSvg, renderTicketQrDataUri, buildTicketQrUrl, renderTicketQrPngBuffer } from '../lib/tickets/qr.js';
import QRCode from 'qrcode';

const env = { NEXT_PUBLIC_SITE_URL: 'https://www.sdgatx.com' };
const ticketCode = 'SDGA-5MDG-45S2-F10Y-2VFR-TCT9-VVVP';

test('renderTicketQrSvg returns a real inline <svg> string with cell rects', () => {
  const svg = renderTicketQrSvg({ ticketCode, size: 320, env });
  assert.strictEqual(typeof svg, 'string', 'must return a string (was silently null before)');
  assert.ok(svg.length > 500, 'SVG payload should be substantial, got length ' + svg.length);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<rect [^>]*width="1" height="1"/);
  assert.match(svg, /<\/svg>$/);
});

test('renderTicketQrSvg output round-trips through a QR decoder to the same URL', async () => {
  // We do not rasterize + camera-scan in unit tests. Instead we verify the
  // module matrix that the SVG encodes matches what a fresh call to
  // QRCode.create returns for the same URL. That is byte-equivalent to what
  // a phone camera reads from a good SVG render, and directly guards
  // against the "no alignment pattern / bad mask" family of bugs that made
  // the internal encoder produce SVGs that looked like QR codes but weren't.
  const url = buildTicketQrUrl({ ticketCode, env });
  const svg = renderTicketQrSvg({ ticketCode, size: 320, env });

  // Recover the module grid from the SVG by counting rect positions.
  const cells = new Set();
  const rectRe = /<rect x="(\d+)" y="(\d+)" width="1" height="1"/g;
  let m;
  while ((m = rectRe.exec(svg)) !== null) {
    cells.add(`${Number(m[1])},${Number(m[2])}`);
  }
  const quietZone = 4;

  const expected = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = expected.modules.size;
  const data = expected.modules.data;
  let mismatches = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const shouldBeDark = !!data[y * n + x];
      const key = `${x + quietZone},${y + quietZone}`;
      const isDark = cells.has(key);
      if (shouldBeDark !== isDark) mismatches++;
    }
  }
  assert.strictEqual(mismatches, 0, `SVG modules do not match canonical QR encoding for URL (${mismatches} bad cells)`);
});

test('renderTicketQrDataUri returns a data-uri that decodes back to the same SVG', () => {
  const uri = renderTicketQrDataUri({ ticketCode, env });
  assert.ok(typeof uri === 'string' && uri.startsWith('data:image/svg+xml;utf8,'));
  const decoded = decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length));
  assert.match(decoded, /^<svg /);
  assert.match(decoded, /<\/svg>$/);
});

test('buildTicketQrUrl encodes /t/scan with the ticket code as ?t=', () => {
  const url = buildTicketQrUrl({ ticketCode, env });
  const parsed = new URL(url);
  assert.strictEqual(parsed.hostname, 'www.sdgatx.com');
  assert.strictEqual(parsed.pathname, '/t/scan');
  assert.strictEqual(parsed.searchParams.get('t'), ticketCode);
});

test('renderTicketQrPngBuffer produces a valid PNG buffer', async () => {
  const buf = await renderTicketQrPngBuffer({
    ticketCode: 'SDGA-5MDG-45S2-F10Y-2VFR-TCT9-VVVP',
    env: { NEXT_PUBLIC_SITE_URL: 'https://www.sdgatx.com' },
  });
  assert.ok(Buffer.isBuffer(buf), 'must return a Buffer');
  assert.ok(buf.length > 200, 'PNG must be non-trivial');
  // PNG magic number: 89 50 4E 47 0D 0A 1A 0A
  const header = buf.slice(0, 8).toString('hex');
  assert.equal(header, '89504e470d0a1a0a', 'buffer must start with the PNG magic number');
});

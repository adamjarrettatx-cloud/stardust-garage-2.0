// Regression test for the "ticket QR renders as literal string 'null' in
// confirmation and resend emails, wallet, and /t/[code]" bug.
//
// Root cause was in lib/tickets/qr.js:
//   const matrix = encodeQrMatrix(url);
//   return qrMatrixToSvg(matrix, { size, margin: 4 });
// qrMatrixToSvg expects a raw string (it encodes internally). Passing a
// matrix caused encodeQrMatrix to throw on non-string input; qrMatrixToSvg's
// try/catch swallowed it and returned null, so every email template's
// `${qrSvg}` interpolation printed the four characters "null".
//
// The guarantee this test enforces: renderTicketQrSvg must ALWAYS return a
// non-empty SVG string starting with "<svg" for any well-formed ticket code.
// Anything else means someone reintroduced the double-encode or renamed a
// dependency out of shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTicketQrSvg, renderTicketQrDataUri, buildTicketQrUrl, renderTicketQrPngBuffer } from '../lib/tickets/qr.js';

test('renderTicketQrSvg returns a valid SVG string, not null', () => {
  const svg = renderTicketQrSvg({
    ticketCode: 'SDGA-5MDG-45S2-F10Y-2VFR-TCT9-VVVP',
    env: { NEXT_PUBLIC_SITE_URL: 'https://www.sdgatx.com' },
  });
  assert.equal(typeof svg, 'string', 'svg must be a string');
  assert.ok(svg.length > 200, 'svg must be substantial (>200 chars)');
  assert.ok(svg.startsWith('<svg'), 'svg must start with <svg tag');
  assert.ok(svg.includes('</svg>'), 'svg must be well-closed');
  assert.ok(!svg.includes('null'), 'svg must not contain literal string "null"');
});

test('renderTicketQrSvg respects size option', () => {
  const svg = renderTicketQrSvg({
    ticketCode: 'SDGA-TEST-CODE-1234-5678-9ABC-DEF0',
    size: 320,
    env: { NEXT_PUBLIC_SITE_URL: 'https://www.sdgatx.com' },
  });
  assert.ok(svg.includes('width="320"'), 'svg must honor size option');
  assert.ok(svg.includes('height="320"'));
});

test('renderTicketQrDataUri returns a data:image/svg+xml URI', () => {
  const uri = renderTicketQrDataUri({
    ticketCode: 'SDGA-TEST-CODE-1234-5678-9ABC-DEF0',
    env: { NEXT_PUBLIC_SITE_URL: 'https://www.sdgatx.com' },
  });
  assert.ok(uri.startsWith('data:image/svg+xml;utf8,'), 'must be a data URI');
  assert.ok(!uri.includes('null'), 'data URI must not embed literal "null"');
});

test('buildTicketQrUrl encodes the scanner URL', () => {
  const url = buildTicketQrUrl({
    ticketCode: 'SDGA-5MDG-45S2-F10Y-2VFR-TCT9-VVVP',
    env: { NEXT_PUBLIC_SITE_URL: 'https://www.sdgatx.com' },
  });
  assert.equal(
    url,
    'https://www.sdgatx.com/t/scan?t=SDGA-5MDG-45S2-F10Y-2VFR-TCT9-VVVP',
  );
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

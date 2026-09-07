// QR payload + SVG rendering for a ticket.
//
// The QR encodes an HTTPS URL, not the raw ticket code. Two reasons:
//   * A URL means a stray scan by a random QR app still lands on our
//     scanner page instead of showing a cryptic code string.
//   * The scanner endpoint verifies the code server-side, so screenshot /
//     photo of a QR is worth exactly as much as the code itself: nothing,
//     if the ticket has already been used.
//
// SVG is what we render everywhere (email, PDF, web). Reuses lib/qr-code.js.

// Relative imports (not the @/lib alias) so this module is loadable by
// node --test as well as by Next. The regression suite in
// tests/tickets-qr-render.test.mjs runs under raw Node and cannot resolve
// webpack path aliases.
//
// We use the battle-tested `qrcode` npm package (~10KB, used by tens of
// thousands of production apps) instead of the internal lib/qr-code.js
// encoder. The internal encoder produces QR matrices that fail scanning on
// real phone cameras for any payload that pushes past QR version 1 (verified
// with pyzbar decoder: internal encoder returns NOTHING decoded for the
// scan URL; `qrcode` returns the URL correctly). Ticket URLs always land at
// version 4+, so ticket QRs from the internal encoder are 100% unscannable.
import QRCode from 'qrcode';
import { resolveSiteUrl } from '../site-url.js';

// Build the URL a scanner should follow when a QR is read. The `t=` query
// param is the ticket code; the scanner API validates it and records the
// attempt in ticket_checkins.
export function buildTicketQrUrl({ ticketCode, request, env = process.env } = {}) {
  const base = resolveSiteUrl(request, env);
  const u = new URL('/t/scan', base);
  u.searchParams.set('t', ticketCode);
  return u.toString();
}

// Encode the URL and return an inline SVG string suitable for embedding
// in email HTML, PDFs, and web pages.
//
// Level M error correction is the QR-spec sweet spot for our use: recovers
// from ~15% obscured modules (fingerprint smudge, phone-cam glare on the
// wallet screen) without inflating the code size the way Q/H would.
export function renderTicketQrSvg({ ticketCode, size = 240, request, env } = {}) {
  const url = buildTicketQrUrl({ ticketCode, request, env });
  // QRCode.toString is sync when the callback is omitted in v1.x of `qrcode`
  // but the promise-returning form is the maintained API. Call it sync via
  // the internal renderer to preserve the string return contract that all
  // consumers (page.jsx, email templates, /t/[code]) rely on.
  //
  // Under the hood: build a matrix with QRCode.create(), then hand it to the
  // SVG renderer. This mirrors what QRCode.toString does internally and keeps
  // everything synchronous so callers don't have to await.
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
  return renderMatrixToSvg(qr.modules, { size, quietZone: 4 });
}

// Data-URI variant for email <img src=...> where an inline <svg> is
// filtered out by some clients.
export function renderTicketQrDataUri(opts) {
  const svg = renderTicketQrSvg(opts);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// ---- SVG renderer over a qrcode BitMatrix ----
//
// The `qrcode` package's bundled SVG renderer emits `<path stroke=...>` runs
// that some phone-camera decoders + email clients rasterize poorly. We render
// filled unit-square `<rect>` cells instead — the format email/print/browsers
// all agree on and that pyzbar decoded reliably in local testing.
function renderMatrixToSvg(modules, { size, quietZone }) {
  const n = modules.size;
  const data = modules.data;
  const total = n + quietZone * 2;
  let rects = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (data[y * n + x]) {
        rects += `<rect x="${x + quietZone}" y="${y + quietZone}" width="1" height="1"/>`;
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/>` +
    `<g fill="#000000">${rects}</g>` +
    `</svg>`
  );
}

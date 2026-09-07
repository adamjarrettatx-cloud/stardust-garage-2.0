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
import { qrMatrixToSvg } from '../qr-code.js';
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
// qrMatrixToSvg takes the RAW STRING to encode (it calls encodeQrMatrix
// itself internally) and a plain options object. This previously did the
// encoding twice and passed a matrix in the string slot:
//
//     const matrix = encodeQrMatrix(url);
//     return qrMatrixToSvg(matrix, { size, margin: 4 });
//
// The second call re-ran encodeQrMatrix on the matrix, which throws on
// non-string input; qrMatrixToSvg's try/catch swallowed it and returned
// null. Every ticket QR in confirmation emails, resend emails, the wallet
// (/account/tickets), and the standalone /t/[code] page rendered as the
// literal string "null" because template code did ${qrSvg}.
//
// Also: qrMatrixToSvg's option is `quietZone`, not `margin`. The bad
// `margin` key was silently ignored, so even a lucky pass-through never
// affected output; kept only for correctness now that we care.
export function renderTicketQrSvg({ ticketCode, size = 240, request, env } = {}) {
  const url = buildTicketQrUrl({ ticketCode, request, env });
  return qrMatrixToSvg(url, { size, quietZone: 4 });
}

// Data-URI variant for email <img src=...> where an inline <svg> is
// filtered out by some clients.
export function renderTicketQrDataUri(opts) {
  const svg = renderTicketQrSvg(opts);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

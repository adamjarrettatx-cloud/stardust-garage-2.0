// QR payload + SVG rendering for a ticket.
//
// The QR encodes an HTTPS URL, not the raw ticket code. Two reasons:
//   * A URL means a stray scan by a random QR app still lands on our
//     scanner page instead of showing a cryptic code string.
//   * The scanner endpoint verifies the code server-side, so screenshot /
//     photo of a QR is worth exactly as much as the code itself: nothing,
//     if the ticket has already been used.
//
// SVG is what we render on the web (wallet, /t/[code], PDFs). For email we
// render PNG bytes and attach them via CID: Gmail, Yahoo, and every desktop
// mail client strip inline <svg> and refuse to render data: URIs in <img>,
// so a CID inline attachment is the only reliable path. Inline SVG stays
// for web-only use where it's crisper and scales.
//
// Encoding is delegated to lib/qr-code.js (which itself delegates to the
// `qrcode` npm package). PNG buffers, needed only here for email CID
// attachments, call qrcode directly since that path is not on the shared
// helper — the shared helper is SVG-only by design.
//
// Relative imports (not the @/lib alias) so this module is loadable by
// node --test as well as by Next. The regression suite in
// tests/tickets-qr-render.test.mjs runs under raw Node and cannot resolve
// webpack path aliases.
import QRCode from 'qrcode';
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
// in the wallet, /t/[code], and PDFs. Uses the shared qrMatrixToSvg helper
// so every SVG QR in the app comes off the same code path.
export function renderTicketQrSvg({ ticketCode, size = 240, request, env } = {}) {
  const url = buildTicketQrUrl({ ticketCode, request, env });
  return qrMatrixToSvg(url, { size, quietZone: 4 });
}

// Data-URI variant. Kept for internal / preview surfaces only; DO NOT use
// in email templates — Gmail, Yahoo, and Outlook refuse to render
// data:image/svg+xml <img> tags. Emails must use renderTicketQrPngBuffer
// + CID attachments instead.
export function renderTicketQrDataUri(opts) {
  const svg = renderTicketQrSvg(opts);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Server-side PNG bytes for a ticket QR. Used for email CID attachments
// where inline SVG is stripped and data URIs are blocked. Returns a Node
// Buffer of a 480x480 PNG at error-correction level M (matches the SVG
// path). Retina-scale (2x the 240 CSS pixel target) so the QR stays crisp
// on high-DPI mobile mail clients that render the CID at ~140-240px.
export async function renderTicketQrPngBuffer({ ticketCode, request, env, size = 480 } = {}) {
  const url = buildTicketQrUrl({ ticketCode, request, env });
  return QRCode.toBuffer(url, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 2,
    width: size,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

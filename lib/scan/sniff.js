import {
  extractMemberIdentityTokenFromScanClient,
  extractPassTokenFromScanClient,
  normalizeTicketCodeShape,
} from './token-shapes.js';

// Given whatever a QR code decoded to, figure out what KIND of QR it is in
// the Stardust universe. Returns one of:
//
//   { kind: 'trial_pass',      token: '<raw pass token>' }
//   { kind: 'ticket',          code:  '<SDGA-XXXX-XXXX...>' }
//   { kind: 'member_id',       token: '<raw identity token>' }
//   { kind: 'ambiguous_token', token: '<bare 43-char base64url>' }
//   { kind: 'unknown' }
//
// The unified scanner UI calls this once per decoded QR and routes the
// result to the matching preview endpoint:
//
//   trial_pass  \u2192 /api/capacity/trial-pass/scan   { mode: 'preview' }
//   ticket      \u2192 /api/tickets/scan               { mode: 'preview' }
//   member_id   \u2192 /api/scan/member-id             { mode: 'preview' }
//
// A bare 43-char base64url string is AMBIGUOUS between member_id and
// trial_pass (both are 32 random bytes). This is only reachable if a QR
// encoded JUST the token instead of the URL \u2014 something we never emit,
// but a third-party QR generator might. We handle that by returning
// `{ kind: 'ambiguous_token', token }` so the caller can try both endpoints.
//
// URL-shaped scans (what we actually emit) are unambiguous because the
// path segment differs.
//
// Client-safe: no node:crypto, no server-only imports. This module is
// bundled into the unified scanner client.
export function sniffScan(payload) {
  if (typeof payload !== 'string' || !payload.trim()) {
    return { kind: 'unknown' };
  }
  const trimmed = payload.trim();

  const isUrl = /^https?:\/\//i.test(trimmed);
  if (isUrl) {
    const memberToken = extractMemberIdentityTokenFromScanClient(trimmed);
    if (memberToken) return { kind: 'member_id', token: memberToken };

    const passToken = extractPassTokenFromScanClient(trimmed);
    if (passToken) return { kind: 'trial_pass', token: passToken };

    const ticketCode = tryExtractTicketFromUrl(trimmed);
    if (ticketCode) return { kind: 'ticket', code: ticketCode };

    return { kind: 'unknown' };
  }

  // Bare (non-URL) payload. Try each sniffer.
  const ticketCode = normalizeTicketCodeShape(trimmed);
  if (ticketCode) return { kind: 'ticket', code: ticketCode };

  const memberToken = extractMemberIdentityTokenFromScanClient(trimmed);
  const passToken = extractPassTokenFromScanClient(trimmed);
  if (memberToken && passToken) {
    return { kind: 'ambiguous_token', token: memberToken };
  }
  if (memberToken) return { kind: 'member_id', token: memberToken };
  if (passToken) return { kind: 'trial_pass', token: passToken };

  return { kind: 'unknown' };
}

function tryExtractTicketFromUrl(input) {
  try {
    const url = new URL(input);

    if (url.pathname === '/t/scan' || url.pathname === '/t/scan/') {
      const t = url.searchParams.get('t');
      return t ? normalizeTicketCodeShape(t) : null;
    }

    const match = url.pathname.match(/^\/t\/([^/]+)\/?$/);
    if (match) {
      const decoded = decodeURIComponent(match[1]);
      return normalizeTicketCodeShape(decoded);
    }

    return null;
  } catch {
    return null;
  }
}

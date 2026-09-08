// Pure token-shape helpers, safe to import from client code.
//
// The trial-pass and member-identity token schemes both use 32 random bytes
// encoded as base64url \u2014 43 chars, [A-Za-z0-9_-]. The functions here validate
// that shape and pull a token out of a URL scan, WITHOUT importing node:crypto
// so this module can be bundled into a client component (the unified scanner).
//
// The lookup routes on the server still call the canonical
// is/hash/generate helpers in lib/trial-pass.js and lib/member-identity.js
// \u2014 those live server-side.

const PASS_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MEMBER_TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export function isWellFormedPassTokenShape(token) {
  return typeof token === 'string' && PASS_TOKEN_RE.test(token);
}

export function isWellFormedMemberIdentityTokenShape(token) {
  return typeof token === 'string' && MEMBER_TOKEN_RE.test(token);
}

// Pull a trial-pass token out of a scanned QR payload. Accepts:
//   * https://.../pass/<token>
//   * bare <token>
// Returns null for anything else.
export function extractPassTokenFromScanClient(scanned) {
  if (typeof scanned !== 'string') return null;
  const trimmed = scanned.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const match = url.pathname.match(/^\/pass\/([^/]+)\/?$/);
      if (!match) return null;
      const decoded = decodeURIComponent(match[1]);
      return isWellFormedPassTokenShape(decoded) ? decoded : null;
    } catch {
      return null;
    }
  }
  return isWellFormedPassTokenShape(trimmed) ? trimmed : null;
}

// Pull a member-identity token out of a scanned QR payload. Accepts:
//   * https://.../member/id/<token>
//   * bare <token>
// Returns null for anything else.
export function extractMemberIdentityTokenFromScanClient(scanned) {
  if (typeof scanned !== 'string') return null;
  const trimmed = scanned.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const match = url.pathname.match(/^\/member\/id\/([^/]+)\/?$/);
      if (!match) return null;
      const decoded = decodeURIComponent(match[1]);
      return isWellFormedMemberIdentityTokenShape(decoded) ? decoded : null;
    } catch {
      return null;
    }
  }
  return isWellFormedMemberIdentityTokenShape(trimmed) ? trimmed : null;
}

// Normalize a ticket code that came off a scanner (case-insensitive, strip
// spaces and dashes) into the canonical PREFIX-XXXX-XXXX-... shape.
// Client-safe copy of lib/tickets/codes.js#normalizeTicketCode.
export function normalizeTicketCodeShape(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!cleaned) return null;
  const m = cleaned.match(/^([A-Z]+)([0-9A-Z]{24})$/);
  if (!m) return null;
  const prefix = m[1];
  const body = m[2].match(/.{1,4}/g).join('-');
  return `${prefix}-${body}`;
}

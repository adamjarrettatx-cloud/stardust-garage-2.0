// Member identity tokens: the durable "member badge" primitive.
//
// A member has ONE identity token, forever, unless it's explicitly rotated
// (leaked, stolen device, etc). Mirrors the trial-pass token model exactly:
//
//   - 256 bits of entropy, base64url encoded (~43 chars)
//   - Raw token lives ONLY in the member's wallet page URL and email; the DB
//     stores just the SHA-256 hash
//   - The token IS the credential: whoever holds it CAN be previewed at the
//     door. Photo verification at the door is what actually gates entry, so a
//     photographed/screenshotted QR gets caught (same trust model as trial
//     passes — see the /pass/[token] page for the pattern being copied)
//   - The QR encodes a real URL: /member/id/<token> so a scan on any camera
//     app resolves to the badge page without an installed app
//
// Why not rotate on a timer:
//   Adam explicitly asked for the "trial-pass My Pass" model — one static
//   value shown on a page. Rotating tokens would break physical printed cards
//   and add a moving part to a system where photo verification is already
//   the real security control.

import { randomBytes, createHash } from 'node:crypto';

// 32 bytes = 256 bits, matching trial-pass. Base64url encoding yields 43 chars
// so the /member/id/<token> URL is ~70 chars — well inside the QR encoder's
// byte-mode ceiling.
export const MEMBER_IDENTITY_TOKEN_BYTES = 32;

export function generateMemberIdentityToken() {
  return randomBytes(MEMBER_IDENTITY_TOKEN_BYTES).toString('base64url');
}

// SHA-256 hex, salt-free, same as trial-pass. Salt is meaningless on a
// 256-bit random value (no dictionary to defend against) and lookups have to
// be deterministic.
export function hashMemberIdentityToken(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return null;
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

// base64url only, length range matches what generateMemberIdentityToken emits
// plus a little slack. Rejecting garbage before it hits the DB keeps a
// smudged scan or a URL-editing guest from turning into a query.
export function isWellFormedMemberIdentityToken(rawToken) {
  return typeof rawToken === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(rawToken);
}

// The URL behind the QR. Real web page so a member whose wallet install failed
// can still show their badge, and any phone camera reads it without a special
// app. Same shape as buildPassUrl().
export function buildMemberIdentityUrl(siteUrl, rawToken) {
  if (!rawToken) return null;
  const base = String(siteUrl || '').replace(/\/+$/, '');
  return `${base}/member/id/${encodeURIComponent(rawToken)}`;
}

// Inverse of buildMemberIdentityUrl. Given whatever a QR scanner decoded,
// pull the identity token out. Accepts:
//
//   1. Full URL from buildMemberIdentityUrl, e.g.
//      "https://www.sdgatx.com/member/id/ABC...xyz"
//   2. The bare token, e.g. "ABC...xyz" — what a QR-generator app or a
//      re-encoded QR would carry
//
// Anything else (Instagram URLs, Wi-Fi payloads, menus, garbage) returns
// null so the unified scanner can move on to the next format. Never throws.
export function extractMemberIdentityTokenFromScan(payload) {
  if (typeof payload !== 'string') return null;
  const trimmed = payload.trim();
  if (!trimmed) return null;

  // Try URL first. Only accept the /member/id/<token> shape on any host —
  // anchoring on the path segment prevents a URL that happens to contain
  // "/member/id/" somewhere from being misread.
  try {
    const url = new URL(trimmed);
    const match = url.pathname.match(/^\/member\/id\/([^/]+)\/?$/);
    if (match) {
      const decoded = decodeURIComponent(match[1]);
      return isWellFormedMemberIdentityToken(decoded) ? decoded : null;
    }
    // A URL that isn't a member-id URL is not a member-id scan.
    return null;
  } catch {
    // Not a URL — fall through to the bare-token path.
  }

  return isWellFormedMemberIdentityToken(trimmed) ? trimmed : null;
}

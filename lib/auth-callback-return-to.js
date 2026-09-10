// SECURITY (Critical C-01): /auth/callback fragment-handoff allowlist.
//
// The /auth/callback route serves a small HTML shell that forwards Supabase
// session tokens (delivered in the URL fragment: `#access_token=...`) to a
// mobile deep link named by ?return_to=... Before this allowlist existed,
// any URL could be passed as return_to; an attacker could persuade a member
// to complete a Supabase link whose return_to pointed at `https://evil.example`
// and the shell would happily concatenate the fragment onto that URL.
// Result: full account takeover with just a click on a magic link or an
// OAuth completion.
//
// This module is the single source of truth for which schemes/origins are
// allowed as fragment-forwarding destinations. Keep it tiny and auditable.
//
// Rules for adding entries:
//   1. Native schemes: add the exact app scheme (with the trailing colon).
//      No host restriction (mobile deep links don't have a stable host).
//   2. Web origins: strongly prefer to NOT add them — for web sign-in,
//      finish the exchange server-side via PKCE (`?code=`) instead of
//      handing session tokens to any browser URL.
//   3. NEVER add a wildcard, a `.*.` pattern, or `https://` origins that
//      you haven't personally reviewed for reflected-XSS / open-redirect.

export const RETURN_TO_ALLOWED_SCHEMES = new Set([
  // Production SDG mobile app (iOS + Android use the same custom scheme;
  // configured in sdg-mobile/app.json as `scheme: 'sdgatx'`).
  'sdgatx:',
]);

const EXPO_DEVELOPMENT_SCHEMES = new Set(['exp:', 'exp+sdg-mobile:']);

function protocolForReturnTo(rawReturnTo) {
  if (!rawReturnTo || typeof rawReturnTo !== 'string') return null;
  let decoded;
  try {
    decoded = decodeURIComponent(rawReturnTo);
  } catch {
    return null;
  }
  try {
    return new URL(decoded).protocol;
  } catch {
    return null;
  }
}

// Exported for the callback route's production observability warning. This
// does not make an Expo destination allowed.
export function isExpoReturnTo(rawReturnTo) {
  return EXPO_DEVELOPMENT_SCHEMES.has(protocolForReturnTo(rawReturnTo));
}

/**
 * True iff `rawReturnTo` is safe to forward the Supabase session fragment to.
 *
 * The value is treated as raw untrusted input straight out of a URL query
 * string. We percent-decode once, parse with WHATWG URL, and check the
 * resulting protocol against the allowlist. Any parse failure, missing
 * scheme, or off-list scheme returns false. In particular this refuses
 * `http:` / `https:` / `javascript:` / `data:` / `file:` — the exact vectors
 * that would let a fragment handoff escape to an attacker-controlled origin.
 *
 * @param {string | null | undefined} rawReturnTo
 * @returns {boolean}
 */
export function isAllowedReturnTo(rawReturnTo) {
  const protocol = protocolForReturnTo(rawReturnTo);
  if (!protocol) return false;
  if (RETURN_TO_ALLOWED_SCHEMES.has(protocol)) return true;

  // Expo / EAS URLs can name an arbitrary development host. Never allow their
  // fragment handoff in production, where that would expose a session token.
  return process.env.NODE_ENV !== 'production' && EXPO_DEVELOPMENT_SCHEMES.has(protocol);
}

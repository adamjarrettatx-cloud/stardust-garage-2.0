// Pure helpers for authenticating API-route callers that are NOT browsers.
//
// The website authenticates with a Supabase session cookie (see
// lib/supabase/server.js), but the mobile app has no cookie jar — it holds a
// Supabase access token and sends it as `Authorization: Bearer <token>`.
// parseBearerToken() is the one piece of that path worth isolating: it has no
// imports, so it is unit testable under `node --test` (see
// tests/request-auth.test.mjs). The actual token -> user exchange lives in
// getRequestUser() in lib/auth-helpers.js.

// Extracts the token from an `Authorization: Bearer <token>` header value.
// Returns null for anything else (missing header, another scheme, empty or
// whitespace-containing token) so callers can treat "no bearer token" and
// "malformed bearer token" identically and fall back to the cookie session.
export function parseBearerToken(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(headerValue.trim());
  return match ? match[1] : null;
}

// Tiny in-memory sliding-window rate limiter, per Node process.
//
// Scope + caveat: Vercel serverless functions can spin up multiple instances,
// so this is a per-instance guardrail — not a global counter. It's enough to
// stop a single client from firing hundreds of requests a second against
// hold-creation or scanner endpoints. For anything requiring hard global
// enforcement (payment routes, auth) we should layer Vercel's own rate limits
// or an Upstash/Redis backend later. Signature is kept compatible so we can
// swap the implementation without changing callers.

import { applyRateLimit } from './rate-limit-core.mjs';
import { createHash } from 'node:crypto';

// Member ID tokens are long-lived credentials. This is deliberately a user-id
// bucket (rather than an IP bucket) because a mobile client may switch
// networks while retrying, and a noisy client should not force QR rotation.
export const MEMBER_IDENTITY_TOKEN_RATE_LIMIT = Object.freeze({
  limit: 20,
  windowMs: 60 * 60 * 1000,
});

// Returns { ok, remaining, retryAfterSeconds }.
export function rateLimit({ key, limit, windowMs }) {
  return applyRateLimit({ key, limit, windowMs });
}

// Build a rate-limit key from the request's best-guess remote IP + a
// namespace, so different routes don't share buckets.
export function keyFromRequest(request, namespace) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  const ip = fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  return `${namespace}:${ip}`;
}

// Do not keep direct identifiers (email addresses or phone numbers) in the
// in-memory limiter. Hashing also makes this helper safe to replace with a
// shared Redis/Upstash implementation later.
export function hashRateLimitKey(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

// Tiny in-memory sliding-window rate limiter, per Node process.
//
// Scope + caveat: Vercel serverless functions can spin up multiple instances,
// so this is a per-instance guardrail — not a global counter. It's enough to
// stop a single client from firing hundreds of requests a second against
// hold-creation or scanner endpoints. For anything requiring hard global
// enforcement (payment routes, auth) we should layer Vercel's own rate limits
// or an Upstash/Redis backend later. Signature is kept compatible so we can
// swap the implementation without changing callers.

const buckets = new Map(); // key -> { count, resetAt }

// Returns { ok, remaining, retryAfterSeconds }.
export function rateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  b.count += 1;
  if (b.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
    };
  }
  return { ok: true, remaining: limit - b.count, retryAfterSeconds: 0 };
}

// Build a rate-limit key from the request's best-guess remote IP + a
// namespace, so different routes don't share buckets.
export function keyFromRequest(request, namespace) {
  const fwd = request.headers.get('x-forwarded-for') || '';
  const ip = fwd.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  return `${namespace}:${ip}`;
}

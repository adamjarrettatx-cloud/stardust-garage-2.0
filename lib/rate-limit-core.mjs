// Framework-independent implementation behind lib/rate-limit.js. Keeping the
// state here allows native Node tests to exercise the same limiter used by
// Next.js route handlers.

const buckets = new Map(); // key -> { count, resetAt }

// Returns { ok, remaining, retryAfterSeconds }.
export function applyRateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  return { ok: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

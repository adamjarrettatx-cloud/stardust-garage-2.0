// Minimal Stripe HTTP client. Uses direct fetch to keep the deploy footprint
// small (no `stripe` npm package) and to match the existing subscription
// checkout route's style. Server-only — never import from a client component.
//
// Every call requires STRIPE_SECRET_KEY, read lazily so builds without the
// var don't crash and so test envs can inject their own via process.env.
//
// Nested params (metadata, line_items, etc.) follow Stripe's bracketed form
// encoding, which is what curl examples and Stripe's docs use.
//
// Idempotency-Key handling: pass `idempotencyKey` to any write and Stripe
// will de-dupe on their side, so retries after a network flake never double
// charge. See https://stripe.com/docs/api/idempotent_requests.

const STRIPE_API = 'https://api.stripe.com/v1';

function requireStripeKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return key;
}

// Turn a nested plain object into Stripe's bracketed form-encoding.
// { metadata: { a: 1 } }        -> metadata[a]=1
// { line_items: [{ price: 'x' }] } -> line_items[0][price]=x
export function encodeStripeForm(params) {
  const out = new URLSearchParams();
  const walk = (value, prefix) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${prefix}[${i}]`));
    } else if (typeof value === 'object' && !(value instanceof Date)) {
      for (const [k, v] of Object.entries(value)) {
        walk(v, prefix ? `${prefix}[${k}]` : k);
      }
    } else {
      out.append(prefix, value instanceof Date ? value.toISOString() : String(value));
    }
  };
  for (const [k, v] of Object.entries(params || {})) walk(v, k);
  return out;
}

async function stripeRequest(method, path, { params, query, idempotencyKey } = {}) {
  const key = requireStripeKey();
  const url = new URL(`${STRIPE_API}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.append(k, String(v));
    }
  }
  const headers = {
    Authorization: `Bearer ${key}`,
  };
  let body;
  if (method !== 'GET' && params) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = encodeStripeForm(params);
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }

  if (!res.ok) {
    const message = json?.error?.message || `Stripe ${method} ${path} failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.stripeCode = json?.error?.code;
    err.stripeType = json?.error?.type;
    err.stripeRequestId = res.headers.get('request-id');
    err.raw = json || text;
    throw err;
  }
  return json;
}

export const stripe = {
  get: (path, opts) => stripeRequest('GET', path, opts),
  post: (path, opts) => stripeRequest('POST', path, opts),
  del: (path, opts) => stripeRequest('DELETE', path, opts),
};

// Look up an existing Stripe customer for a member, or create one. Storing
// the id back on member_profiles is the caller's responsibility so a single
// customer is reused across membership + ticket + wallet flows.
export async function findOrCreateStripeCustomer({ existingId, email, name, metadata }) {
  if (existingId) {
    return stripe.get(`/customers/${existingId}`);
  }
  return stripe.post('/customers', {
    params: {
      ...(email ? { email } : {}),
      ...(name ? { name } : {}),
      ...(metadata ? { metadata } : {}),
    },
  });
}

// Web Crypto based HMAC-SHA256 signature verification — same technique as
// the existing subscription webhook (app/api/stripe/webhook/route.js), kept
// separate here so both handlers can share it. Constant-time compare.
export async function verifyStripeSignature(rawBody, signature, secret, { toleranceSeconds = 300 } = {}) {
  if (!signature || !secret || typeof rawBody !== 'string') return false;
  const parts = signature.split(',');
  let timestamp = null;
  let v1 = null;
  for (const part of parts) {
    const [k, v] = part.split('=');
    if (k === 't') timestamp = v;
    if (k === 'v1') v1 = v;
  }
  if (!timestamp || !v1) return false;

  // Replay-window guard. Stripe's own SDK uses 5 min by default.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > toleranceSeconds) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${rawBody}`));
  const hex = Array.from(new Uint8Array(signed)).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== v1.length) return false;
  let mismatch = 0;
  for (let i = 0; i < hex.length; i++) mismatch |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return mismatch === 0;
}

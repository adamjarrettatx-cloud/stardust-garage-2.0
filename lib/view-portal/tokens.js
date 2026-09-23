// Web Crypto works in both the middleware Edge runtime and Node route handlers.
const enc = new TextEncoder();
function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode(text) {
  if (!/^[\w-]+$/.test(text)) throw new Error('Invalid token encoding');
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
async function key(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signViewToken(payload, secret) {
  const body = encode(enc.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body));
  return `${body}.${encode(new Uint8Array(signature))}`;
}
export async function verifyViewToken(token, secret, { purpose, audience, ownerId, maxAge, now = Date.now() / 1000 }) {
  try {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    if (!await crypto.subtle.verify('HMAC', await key(secret), decode(parts[1]), enc.encode(parts[0]))) return null;
    const value = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (value.purpose !== purpose || value.aud !== audience || value.owner !== ownerId) return null;
    if (!Number.isInteger(value.iat) || !Number.isInteger(value.exp) || value.iat > now + 5
      || value.exp <= now || value.exp <= value.iat || value.exp - value.iat > maxAge) return null;
    if (!/^[0-9a-f-]{36}$/i.test(value.jti || '')) return null;
    return value;
  } catch { return null; }
}

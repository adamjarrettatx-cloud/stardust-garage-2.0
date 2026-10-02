import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Encrypt, not merely sign: exposing the inner Supabase hash would allow its
// longer Auth expiry to bypass our 60-second handoff limit.
function key(secret) {
  if (!secret || secret.length < 24) throw new Error('Handoff encryption unavailable');
  return createHash('sha256').update(`sdg-mobile-handoff-v1:${secret}`).digest();
}
export function sealHandoff({ tokenHash, userId, returnTo }, secret, now = Date.now()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ tokenHash, userId, returnTo, issuedAt: now, expiresAt: now + 60000 }), 'utf8'),
    cipher.final(),
  ]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')}`;
}
export function openHandoff(token, secret, now = Date.now()) {
  try {
    if (typeof token !== 'string' || token.length > 4096 || !/^v1\.[A-Za-z0-9_-]+$/.test(token)) return null;
    const raw = Buffer.from(token.slice(3), 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
    if (!Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt - payload.issuedAt !== 60000 || now < payload.issuedAt || now >= payload.expiresAt ||
      typeof payload.tokenHash !== 'string' || !payload.tokenHash ||
      typeof payload.userId !== 'string' || !payload.userId ||
      (payload.returnTo !== null && (typeof payload.returnTo !== 'string' || !payload.returnTo.startsWith('/')))) return null;
    return payload;
  } catch { return null; }
}

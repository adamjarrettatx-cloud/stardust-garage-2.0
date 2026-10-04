import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Sealed copy of a Trial SDG Pass token, so a signed-in guest's profile can
// redraw the same QR their email carries.
//
// trial_passes.qr_token_hash stays the only lookup key: door scans, /pass/<t>
// and the atomic admission function all match on the SHA-256 hash exactly as
// before. qr_token_sealed is AES-256-GCM ciphertext of that raw token, readable
// only with a server secret, and is decrypted only for the authenticated owner
// of the pass (see lib/account-trial-pass.js). A database read alone does not
// yield a usable credential.
//
// The key is domain-separated from the service-role secret, mirroring
// lib/mobile-handoff-token.mjs. If that secret is ever rotated, old seals stop
// opening and the profile simply re-mints the pass token once.

function key(secret) {
  if (!secret || secret.length < 24) throw new Error('Trial pass seal key unavailable');
  return createHash('sha256').update(`sdg-trial-pass-qr-v1:${secret}`).digest();
}

export function sealSecret() {
  return process.env.TRIAL_PASS_QR_SEAL_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

export function sealPassToken(rawToken, secret = sealSecret()) {
  if (typeof rawToken !== 'string' || !rawToken) return null;
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
    const ciphertext = Buffer.concat([cipher.update(rawToken, 'utf8'), cipher.final()]);
    return `v1.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')}`;
  } catch {
    // Sealing is an enhancement. A pass without a seal still works everywhere;
    // the profile re-mints it on first view.
    return null;
  }
}

export function openPassToken(sealed, secret = sealSecret()) {
  try {
    if (typeof sealed !== 'string' || sealed.length > 512 || !/^v1\.[A-Za-z0-9_-]+$/.test(sealed)) return null;
    const raw = Buffer.from(sealed.slice(3), 'base64url');
    if (raw.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', key(secret), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

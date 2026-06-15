// Pure, dependency-light helpers for capacity DOOR DEVICE tokens (Phase 1.1).
//
// Goal: the two Unihertz Jelly2 door phones must NOT have to stay signed into a
// real team account (which will soon carry MFA + 30-day forced logouts). Instead
// an admin provisions each device once; the device then holds a long, random,
// REVOCABLE token that is scoped to exactly one door operation:
//   * a 'front_door' token may READ status and CHECK IN only
//   * an 'exit_door'  token may READ status and CHECK OUT only
//
// Only `crypto` (Node built-in) is imported, so every export here is unit
// testable under `node --test` and safe to import from server route handlers.
// NEVER import this from a client component — it must never reach the browser
// (it would expose the hashing scheme and tempt storing raw tokens client-side).
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

// The two device roles a token can be minted for. Mirrors the CHECK constraint
// on public.capacity_device_tokens.device_role and the existing
// capacity_events.source values 'front_door' / 'exit_door'.
export const DEVICE_ROLES = ['front_door', 'exit_door'];

// Per-role capability map. This is the single source of truth for what a device
// token is allowed to do. The status read is always permitted for a valid token
// (scoped to its own door); the write op is the ONE mutation it may perform.
//   - op:     the capacity operation name dispatched to the RPC layer
//   - source: the audit-log `source` recorded for that device's actions
const DEVICE_ROLE_CAPS = {
  front_door: { op: 'check_in', source: 'front_door' },
  exit_door: { op: 'check_out', source: 'exit_door' },
};

export function isValidDeviceRole(role) {
  return DEVICE_ROLES.includes(role);
}

// Number of random bytes in a raw device token. 32 bytes = 256 bits of entropy,
// rendered base64url (~43 chars). Long enough that brute-forcing a live token is
// infeasible; short enough to fit comfortably in a URL the admin pastes once.
export const DEVICE_TOKEN_BYTES = 32;

// Generate a fresh raw token. base64url so it is URL-safe (no +,/,= to escape).
// The RAW token is returned to the admin exactly once at creation and never
// stored; only its hash is persisted.
export function generateDeviceToken() {
  return randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
}

// Hash a raw token for at-rest storage. SHA-256 hex. A token is high-entropy
// (256 random bits), so a plain salt-free cryptographic hash is appropriate here
// — there is nothing to brute-force the way a low-entropy password would invite,
// and we need a deterministic value to look up by. We compare hashes (not raw
// tokens) and use a constant-time compare on verification to avoid timing leaks.
export function hashDeviceToken(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return null;
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

// Constant-time comparison of a candidate raw token against a stored hash.
// Returns false on any shape mismatch rather than throwing, so callers can treat
// "bad token" and "no token" uniformly.
export function verifyDeviceToken(rawToken, storedHash) {
  const candidate = hashDeviceToken(rawToken);
  if (!candidate || typeof storedHash !== 'string' || storedHash.length === 0) {
    return false;
  }
  // Both are fixed-length sha256 hex; bail if lengths differ (timingSafeEqual
  // throws on unequal-length buffers).
  if (candidate.length !== storedHash.length) return false;
  try {
    return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

// Extract a device token from a request. We accept it in two places:
//   1. Authorization: Bearer <token>   (preferred — never logged in URLs)
//   2. ?token=<token> query param      (how the Jelly2 first opens the link)
// The query form is acceptable for Phase 1.1 because the token is long, random,
// hashed server-side, revocable, and narrowly scoped to one door op.
export function extractDeviceToken({ authHeader, queryToken } = {}) {
  if (typeof authHeader === 'string') {
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (m && m[1].trim()) return m[1].trim();
  }
  if (typeof queryToken === 'string' && queryToken.trim()) return queryToken.trim();
  return null;
}

// Given a verified device row's role, return the capability the token grants, or
// null for an unknown role. Used by the device API to decide which RPC source to
// stamp and to reject any op the token is not scoped for.
export function deviceCapability(role) {
  return DEVICE_ROLE_CAPS[role] || null;
}

// True iff a device with `role` is permitted to perform capacity operation `op`.
// A front_door token can ONLY check_in; an exit_door token can ONLY check_out.
// Neither may reset/adjust/start/end or touch the opposite door's operation.
export function deviceCanPerform(role, op) {
  const cap = DEVICE_ROLE_CAPS[role];
  return Boolean(cap) && cap.op === op;
}

// A device row is usable only when it exists, is active, and is not revoked.
// Centralized so the API and any future UI agree on what "live" means.
export function isDeviceActive(device) {
  return Boolean(device) && device.active === true && !device.revoked_at;
}

// Build the one-time setup URL the admin copies onto the Jelly2. The raw token
// rides in the query string so opening the link on the phone lands directly on
// the door page already authorized. `origin` is the site origin (no trailing
// slash required); `role` selects the door page.
export function buildDeviceSetupUrl(origin, role, rawToken) {
  if (!isValidDeviceRole(role) || !rawToken) return null;
  const base = (origin || '').replace(/\/+$/, '');
  const path = role === 'front_door' ? '/capacity/front-door' : '/capacity/exit-door';
  return `${base}${path}?token=${encodeURIComponent(rawToken)}`;
}

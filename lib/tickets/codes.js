// Ticket code + hold token generators.
//
// A ticket_code is the opaque string that:
//   * lives on public.tickets.ticket_code (unique index)
//   * is embedded in the QR payload (see lib/tickets/qr.js)
//   * is what the scanner posts back for validation
//
// We use base32 (Crockford, no I/L/O/U to avoid handscanning ambiguity)
// over 15 bytes of randomness => 24 characters, ~120 bits of entropy.
// Reads well over a phone camera and never collides in practice.
//
// Hold tokens are shorter — they only need to be unguessable for the
// ~15 minute checkout window — but use the same alphabet for consistency.

import crypto from 'crypto';

// Crockford base32 minus I, L, O, U to avoid ambiguity on prints.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

// ~120 bits entropy — 15 bytes -> 24 chars. Chunk into groups of 4 with
// dashes for legibility on printed / emailed tickets: SDGA-XXXX-XXXX-XXXX-XXXX-XXXX
export function generateTicketCode({ prefix = 'SDGA' } = {}) {
  const raw = base32Encode(crypto.randomBytes(15));
  const grouped = raw.match(/.{1,4}/g).join('-');
  return `${prefix}-${grouped}`;
}

// Normalize a code that came off a scanner (case-insensitive, strip spaces
// and dashes) before DB lookup, so an operator typing "sdga xxxx" still hits.
export function normalizeTicketCode(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input.trim().toUpperCase().replace(/[\s-]/g, '');
  if (!cleaned) return null;
  // Match the emitted format: prefix + 24 chars.
  const m = cleaned.match(/^([A-Z]+)([0-9A-Z]{24})$/);
  if (!m) return null;
  const prefix = m[1];
  const body = m[2].match(/.{1,4}/g).join('-');
  return `${prefix}-${body}`;
}

// 128 bits, 20 char base32. Used as an opaque handle passed to Stripe as
// metadata and looked up on webhook.
export function generateHoldToken() {
  return `hld_${base32Encode(crypto.randomBytes(16)).slice(0, 20)}`;
}

// Stripe requires idempotency keys under 255 chars; keep them short but
// unique per (hold_id, purpose) so a retry of the same intent is de-duped.
export function stripeIdempotencyKey(purpose, id) {
  return `sdg_${purpose}_${id}`.slice(0, 200);
}

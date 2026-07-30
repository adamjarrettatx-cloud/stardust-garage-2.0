// The consent signature a first-time guest draws at the door kiosk: what counts
// as a usable one, where it lives in storage, and how staff read it back.
//
// Pure and dependency-free — same rule as lib/guestlist-checkin.js — so the
// kiosk client (which produces the data URL from a <canvas>) and the route
// handler (which decodes it) cannot drift on the limits, and so all of it is
// unit-testable under `node --test`.
//
// The bucket is PRIVATE and stays that way. This is a TCPA-style opt-in record
// tied to a named person's phone number, so it is never served from a public
// storage URL: staff read it back through /api/admin/guest-signature/[id],
// which mints a short-lived signed URL behind an admin gate.

export const GUEST_SIGNATURE_BUCKET = 'guest-signatures';
export const GUEST_SIGNATURE_CONTENT_TYPE = 'image/png';

// How long the signed URL handed to a staff browser stays good for. Long enough
// to survive a redirect and a slow venue connection, short enough that a URL
// copied out of history is dead by the time anyone else finds it.
export const SIGNATURE_URL_TTL_SECONDS = 60;

// A finger-drawn signature on a retina iPad is a few tens of KB. The ceiling is
// generous for that and small enough that a malformed or hostile body is
// rejected before it ever reaches storage.
export const MAX_SIGNATURE_BYTES = 512 * 1024;

// A sanity floor for a truncated or garbage payload, NOT an emptiness check: a
// blank canvas still exports as a full-size PNG. Whether the guest actually drew
// anything is decided by the stroke count in SignaturePad, which is the only
// place that can tell a signature from an untouched pad.
export const MIN_SIGNATURE_BYTES = 256;

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;

// The 8-byte PNG magic number is fixed, so the first 11 base64 characters of
// any PNG are too. Cheap way to reject a JPEG (or arbitrary bytes) relabelled as
// image/png without decoding the whole payload.
const PNG_BASE64_PREFIX = 'iVBORw0KGgo';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Byte length of a base64 payload without decoding it.
export function base64ByteLength(base64) {
  const text = typeof base64 === 'string' ? base64 : '';
  if (text.length === 0 || text.length % 4 !== 0) return 0;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  return (text.length / 4) * 3 - padding;
}

// Validate the data URL the canvas produced and hand back the raw base64 so the
// caller can `Buffer.from(base64, 'base64')` it straight into storage.
//
// Every error string is phrased for the door attendant holding the iPad, because
// they are shown verbatim in the check-in sheet.
export function parseSignatureDataUrl(dataUrl) {
  const value = typeof dataUrl === 'string' ? dataUrl.trim() : '';
  if (value === '') {
    return { valid: false, error: 'Ask the guest to sign before checking them in.' };
  }

  const match = PNG_DATA_URL.exec(value);
  if (!match || !match[1].startsWith(PNG_BASE64_PREFIX)) {
    return { valid: false, error: 'That signature could not be read. Clear it and sign again.' };
  }

  const base64 = match[1];
  const bytes = base64ByteLength(base64);
  if (bytes < MIN_SIGNATURE_BYTES) {
    return { valid: false, error: 'That signature could not be read. Clear it and sign again.' };
  }
  if (bytes > MAX_SIGNATURE_BYTES) {
    return { valid: false, error: 'That signature is too large to save. Clear it and sign again.' };
  }

  return { valid: true, base64, bytes };
}

// Signatures are filed under the profile they belong to, with an unguessable
// object name: `<guestProfileId>/<uuid>.png`. The prefix makes the bucket
// readable by a human auditing one guest, and keeps a re-signature from
// clobbering the record it supersedes.
export function guestSignatureStoragePath(guestProfileId, key) {
  return `${guestProfileId}/${key}.png`;
}

// Guard for a path read back out of the database before it is handed to
// storage, so a corrupted column value can never be used to reach an object
// outside this bucket's layout.
export function isGuestSignaturePath(path) {
  if (typeof path !== 'string') return false;
  const parts = path.split('/');
  if (parts.length !== 2 || !parts[1].endsWith('.png')) return false;
  return UUID.test(parts[0]) && UUID.test(parts[1].slice(0, -4));
}

// Shared constants + helpers for the contract lifecycle that sits on top of the
// document hub. These are intentionally dependency-free so they can be imported
// from both server route handlers and (the non-secret parts) client components.
//
// The contract lifecycle is layered ON the existing `documents` table: a
// document in the `contracts` category MAY have an associated contract record
// (see the 20260614_contract_lifecycle migration) tracking signature status and
// SignNow references. Nothing here calls an external API.

// Canonical contract status progression. `void`/`declined` are terminal.
export const CONTRACT_STATUSES = [
  { value: 'draft',          label: 'Draft',           terminal: false },
  { value: 'pending_review', label: 'Pending Review',  terminal: false },
  { value: 'sent',           label: 'Sent for Signature', terminal: false },
  { value: 'partially_signed', label: 'Partially Signed', terminal: false },
  { value: 'signed',         label: 'Fully Signed',    terminal: true  },
  { value: 'declined',       label: 'Declined',        terminal: true  },
  { value: 'void',           label: 'Void',            terminal: true  },
  { value: 'expired',        label: 'Expired',         terminal: true  },
];

export const CONTRACT_STATUS_VALUES = new Set(CONTRACT_STATUSES.map((s) => s.value));

// Allowed forward transitions. Used to validate status changes server-side so
// the UI can't move a contract from, say, `signed` back to `draft`.
export const CONTRACT_TRANSITIONS = {
  draft:            ['pending_review', 'sent', 'void'],
  pending_review:   ['draft', 'sent', 'void'],
  sent:             ['partially_signed', 'signed', 'declined', 'expired', 'void'],
  partially_signed: ['signed', 'declined', 'expired', 'void'],
  signed:           [],
  declined:         ['draft', 'void'],
  void:             [],
  expired:          ['draft', 'void'],
};

export function isValidContractStatus(status) {
  return CONTRACT_STATUS_VALUES.has(status);
}

export function canTransitionContract(from, to) {
  if (!isValidContractStatus(from) || !isValidContractStatus(to)) return false;
  return (CONTRACT_TRANSITIONS[from] || []).includes(to);
}

export function isTerminalContractStatus(status) {
  return CONTRACT_STATUSES.find((s) => s.value === status)?.terminal ?? false;
}

// LOCKED CONTRACTS.
//
// Once signatures exist on a document, the terms of that document are no longer
// ours to change: editing the counterparty, dates, signers or field values on a
// partially- or fully-signed agreement would make our record disagree with the
// paper the other side actually signed. Those contracts are read-only and a
// change requires a new draft or replacement contract.
//
// 'declined', 'void' and 'expired' are terminal but nothing was executed, so
// they're locked too — reopening them would be a backwards transition, which the
// state machine already forbids.
export const CONTRACT_LOCKED_STATUSES = ['partially_signed', 'signed', 'declined', 'void', 'expired'];

export function isContractLocked(status) {
  return CONTRACT_LOCKED_STATUSES.includes(status);
}

// Fields that stay editable on a locked contract. `notes` is Stardust's own
// internal annotation — it is not part of the agreement and is never rendered
// into the PDF, so staff can keep annotating an executed contract.
export const CONTRACT_LOCKED_EDITABLE_FIELDS = ['notes'];

// Given a patch, return the keys that a locked contract will not accept.
export function lockedContractViolations(patch = {}) {
  return Object.keys(patch).filter((k) => !CONTRACT_LOCKED_EDITABLE_FIELDS.includes(k));
}

// The e-signature provider. Only 'signnow' is planned, but keeping this as an
// enum lets us swap or add providers without a schema change.
export const SIGNATURE_PROVIDERS = ['none', 'signnow', 'manual'];

// Shape of a signer/counterparty entry stored in contracts.signers (jsonb[]).
// Documented here so callers build consistent objects.
//   {
//     name: string,
//     email: string,
//     role: 'signer' | 'cc' | 'approver',
//     order: number,        // signing order (1-based)
//     status: 'pending' | 'signed' | 'declined',
//     signed_at: string|null
//   }
export function normalizeSigner(input = {}) {
  return {
    name: String(input.name || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    role: ['signer', 'cc', 'approver'].includes(input.role) ? input.role : 'signer',
    order: Number.isInteger(input.order) && input.order > 0 ? input.order : 1,
    status: ['pending', 'signed', 'declined'].includes(input.status) ? input.status : 'pending',
    signed_at: input.signed_at || null,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns { ok: true, signers } or { ok: false, error }.
export function validateSigners(rawSigners) {
  if (!Array.isArray(rawSigners)) return { ok: false, error: 'signers must be an array' };
  if (rawSigners.length > 20) return { ok: false, error: 'too many signers (max 20)' };
  const signers = [];
  for (const raw of rawSigners) {
    const s = normalizeSigner(raw);
    if (!s.name) return { ok: false, error: 'each signer needs a name' };
    if (!EMAIL_RE.test(s.email)) return { ok: false, error: `invalid signer email: ${s.email || '(empty)'}` };
    signers.push(s);
  }
  return { ok: true, signers };
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return e && EMAIL_RE.test(e) ? e : null;
}

// The effective/expiration values are full timestamps (timestamptz columns).
//
// TIMEZONE CONVENTION (must stay consistent across the migration, this helper,
// and the UI formatters in ContractPanel.js): a contract's effective/expiration
// instant is entered and displayed as VENUE-LOCAL wall-clock time. The venue is
// in Austin, TX, so the canonical zone is America/Chicago (CST/CDT, DST-aware).
// A zoneless value the operator types — a `datetime-local` (`YYYY-MM-DDTHH:MM`)
// or a bare `YYYY-MM-DD` (start of that venue-local day) — represents that wall
// clock at the venue, and we store the matching absolute UTC instant.
//
// Doing this without a tz library: Intl.DateTimeFormat with timeZone set tells
// us the venue wall-clock for any UTC instant. To invert it (wall-clock -> UTC)
// we make a first guess treating the components as UTC, measure how far that
// instant's venue wall-clock is from the target, and correct. One correction is
// enough except exactly on a DST transition; a second pass makes it exact.
export const CONTRACT_TIME_ZONE = 'America/Chicago';

const DTL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// Wall-clock parts (in `timeZone`) for a given epoch-ms instant.
function zonedParts(ms, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of fmt.formatToParts(ms)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return p;
}

// Epoch-ms for a venue-local wall clock, accounting for the zone's UTC offset
// (including DST) at that wall clock.
function zonedWallClockToUtcMs(y, mo, d, h, mi, s, timeZone) {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const wall1 = zonedParts(asUtc, timeZone);
  const wall1AsUtc = Date.UTC(wall1.year, wall1.month - 1, wall1.day, wall1.hour, wall1.minute, wall1.second);
  let guess = asUtc - (wall1AsUtc - asUtc);
  const wall2 = zonedParts(guess, timeZone);
  const wall2AsUtc = Date.UTC(wall2.year, wall2.month - 1, wall2.day, wall2.hour, wall2.minute, wall2.second);
  guess += asUtc - wall2AsUtc;
  return guess;
}

// Parse an untrusted effective/expiration input into a canonical UTC ISO string
// (or null). Returns { ok, value } / { ok: false }.
export function normalizeContractDateTime(value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const v = value.trim();
  if (!v) return { ok: true, value: null };

  // Zoneless inputs are venue-local wall clock.
  let m = DTL_RE.exec(v);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    const ms = zonedWallClockToUtcMs(+y, +mo, +d, +h, +mi, s ? +s : 0, CONTRACT_TIME_ZONE);
    return { ok: true, value: new Date(ms).toISOString() };
  }
  m = DATE_ONLY_RE.exec(v);
  if (m) {
    const [, y, mo, d] = m;
    const ms = zonedWallClockToUtcMs(+y, +mo, +d, 0, 0, 0, CONTRACT_TIME_ZONE);
    return { ok: true, value: new Date(ms).toISOString() };
  }

  // Anything else must carry an explicit zone (e.g. a full ISO-8601 string);
  // we accept it as an absolute instant and canonicalize to UTC.
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return { ok: false };
  return { ok: true, value: new Date(ms).toISOString() };
}

// Format a stored ISO instant as the venue-local `datetime-local` input value
// (`YYYY-MM-DDTHH:MM`). Returns '' for empty/invalid input. Used by the editor
// so the round-trip parse/format is stable in CONTRACT_TIME_ZONE regardless of
// the browser's own timezone.
export function isoToVenueInputValue(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const p = zonedParts(ms, CONTRACT_TIME_ZONE);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// Human-readable venue-local rendering of a stored ISO instant, e.g.
// "Jan 15, 2026, 9:00 AM CST". Returns the raw string on unparseable input.
export function formatVenueDateTime(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: CONTRACT_TIME_ZONE,
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(ms);
}

// Build a sanitized partial update for a document_contracts row from an
// untrusted JSON body. Returns { ok: true, patch } or { ok: false, error }.
// Status changes are NOT handled here — they go through the dedicated
// transition validator so we can enforce the state machine + audit them.
export function buildContractPatch(body = {}) {
  const patch = {};

  if ('signature_provider' in body) {
    if (!SIGNATURE_PROVIDERS.includes(body.signature_provider)) {
      return { ok: false, error: `invalid signature_provider` };
    }
    patch.signature_provider = body.signature_provider;
  }

  if ('counterparty_name' in body) {
    patch.counterparty_name = String(body.counterparty_name || '').trim() || null;
  }
  if ('counterparty_email' in body) {
    const raw = String(body.counterparty_email || '').trim();
    if (raw && !EMAIL_RE.test(raw.toLowerCase())) {
      return { ok: false, error: 'invalid counterparty_email' };
    }
    patch.counterparty_email = cleanEmail(raw);
  }

  if ('signers' in body) {
    const res = validateSigners(body.signers);
    if (!res.ok) return res;
    patch.signers = res.signers;
  }

  if ('event_id' in body) {
    if (body.event_id === null || body.event_id === '') patch.event_id = null;
    else if (typeof body.event_id === 'string' && UUID_RE.test(body.event_id)) patch.event_id = body.event_id;
    else return { ok: false, error: 'invalid event_id' };
  }

  // PROFILE LINKAGE. These are the columns that make a contract belong to real
  // records instead of a typed-in counterparty name: the Event Organizer
  // (contact_id) plus the optional artist/collective/vendor counterparties, the
  // Master Agreement the contract sits under, and the staff owner. All are
  // nullable UUIDs and all are optional, so contracts created before this
  // workflow are untouched.
  for (const idField of [
    'contact_id',
    'master_contract_id',
    'artist_contact_id',
    'collective_contact_id',
    'vendor_contact_id',
    'owner_user_id',
  ]) {
    if (!(idField in body)) continue;
    const raw = body[idField];
    if (raw === null || raw === '') {
      patch[idField] = null;
    } else if (typeof raw === 'string' && UUID_RE.test(raw)) {
      patch[idField] = raw;
    } else {
      return { ok: false, error: `invalid ${idField}` };
    }
  }

  for (const dateField of ['effective_date', 'expiration_date']) {
    if (dateField in body) {
      const res = normalizeContractDateTime(body[dateField]);
      if (!res.ok) return { ok: false, error: `invalid ${dateField} (expected a date & time)` };
      patch[dateField] = res.value;
    }
  }

  if ('external_template_id' in body) {
    patch.external_template_id = String(body.external_template_id || '').trim() || null;
  }

  if ('notes' in body) {
    patch.notes = String(body.notes || '').trim() || null;
  }

  return { ok: true, patch };
}

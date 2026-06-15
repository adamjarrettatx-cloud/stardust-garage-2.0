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
// The UI sends either a `datetime-local` value (`YYYY-MM-DDTHH:MM`, no zone) or
// a full ISO-8601 string. A bare `YYYY-MM-DD` is still accepted for backward
// compatibility and treated as midnight of that day. We normalize everything to
// an ISO-8601 string so Postgres stores a consistent timestamptz.
export function normalizeContractDateTime(value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const v = value.trim();
  if (!v) return { ok: true, value: null };
  // Date-only -> treat as start of that day.
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00` : v;
  const ms = Date.parse(candidate);
  if (Number.isNaN(ms)) return { ok: false };
  return { ok: true, value: new Date(ms).toISOString() };
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

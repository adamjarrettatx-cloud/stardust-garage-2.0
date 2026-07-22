// Shared, dependency-free helpers for the contract field editor + send flow.
//
// A "field" is a box placed on a page of a contract PDF. The same shape is used
// in contract_templates.field_layout AND document_contracts.field_layout:
//
//   {
//     id: 'f_<random>',
//     type: 'text' | 'checkbox' | 'signature' | 'initials',
//     label: 'Counterparty Legal Name',
//     page_number: 0,               // 0-indexed
//     x: 100, y: 200,               // see COORDINATE SYSTEM below
//     width: 160, height: 20,       // PDF points
//     required: true,
//     assigned_to: 'business' | 'signer_1' | 'signer_2' | ...
//   }
//
// ===========================================================================
// COORDINATE SYSTEM  (READ THIS BEFORE TOUCHING PLACEMENT MATH)
// ===========================================================================
// Stored coordinates are always: ORIGIN = BOTTOM-LEFT of the page, UNITS = PDF
// points (1/72 inch), (x, y) = the BOTTOM-LEFT corner of the field box, page
// 0-indexed. This is the native PDF / pdf-lib coordinate space, so baking
// business values into the PDF (server, pdf-lib) needs NO transform at all.
//
// WHY BOTTOM-LEFT (and the one thing left to confirm):
// SignNow's public docs do NOT state whether their Fields API measures y from
// the top or the bottom of the page, and this could not be verified against a
// live account during the build (the build sandbox had no authenticated SignNow
// egress). We therefore follow the documented fallback: assume SignNow shares
// the PDF-native bottom-left/points system, which keeps ONE coordinate system
// for both baked (pdf-lib) content and SignNow fields.
//
// If the first real send shows SIGNER fields landing vertically mirrored,
// SignNow is top-left instead. Flipping is a ONE-LINE change: set
// SIGNNOW_FIELD_Y_ORIGIN to 'top-left' below. Everything else (the editor,
// business-value baking) is unaffected because those are anchored to the PDF's
// own bottom-left space, which is not in question.
export const SIGNNOW_FIELD_Y_ORIGIN = 'bottom-left'; // 'bottom-left' | 'top-left'

export const FIELD_TYPES = ['text', 'checkbox', 'signature', 'initials'];

// Max signer slots offered in the editor. Actual signers are chosen at send
// time; slots map by POSITION to the signers array (signer_1 -> order 1, etc.).
export const MAX_SIGNER_SLOTS = 4;

export const ASSIGNABLE_ROLES = [
  'business',
  ...Array.from({ length: MAX_SIGNER_SLOTS }, (_, i) => `signer_${i + 1}`),
];

// Distinct colors per assignee so the editor can badge fields at a glance.
export const ROLE_COLORS = {
  business: '#fbbf24', // amber — staff fills before send
  signer_1: '#60a5fa', // blue
  signer_2: '#a78bfa', // violet
  signer_3: '#4ade80', // green
  signer_4: '#f472b6', // pink
};

export function roleColor(assignedTo) {
  return ROLE_COLORS[assignedTo] || '#8a8a8a';
}

export function roleLabel(assignedTo) {
  if (assignedTo === 'business') return 'Business';
  const m = /^signer_(\d+)$/.exec(assignedTo || '');
  if (m) return `Signer ${m[1]}`;
  return assignedTo || '';
}

// signer_N -> N (1-based). Returns null for 'business'/invalid.
export function signerSlotIndex(assignedTo) {
  const m = /^signer_(\d+)$/.exec(assignedTo || '');
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function isSignerRole(assignedTo) {
  return signerSlotIndex(assignedTo) !== null;
}

export function isBusinessRole(assignedTo) {
  return assignedTo === 'business';
}

// Short, collision-resistant field id. crypto.randomUUID isn't guaranteed in
// every runtime this module is imported from, so keep it dependency-free.
export function newFieldId() {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36).slice(-4);
  return `f_${time}${rand}`;
}

function toFiniteNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Coerce one untrusted field object into the canonical shape, or return null if
// it is unusable (bad type / role / geometry). Numbers are rounded to 2dp so
// stored layouts stay tidy.
export function normalizeField(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;

  const type = FIELD_TYPES.includes(raw.type) ? raw.type : null;
  if (!type) return null;

  const assigned_to = ASSIGNABLE_ROLES.includes(raw.assigned_to) ? raw.assigned_to : null;
  if (!assigned_to) return null;

  const page_number = Math.max(0, Math.trunc(toFiniteNumber(raw.page_number, 0)));
  const round = (n) => Math.round(toFiniteNumber(n) * 100) / 100;

  const x = round(raw.x);
  const y = round(raw.y);
  const width = round(raw.width);
  const height = round(raw.height);
  if (width <= 0 || height <= 0) return null;

  const id = typeof raw.id === 'string' && /^f_[a-z0-9]+$/i.test(raw.id) ? raw.id : newFieldId();
  const label = String(raw.label || '').trim().slice(0, 120) || roleLabel(assigned_to);

  return {
    id,
    type,
    label,
    page_number,
    x,
    y,
    width,
    height,
    required: raw.required !== false, // default required
    assigned_to,
  };
}

// Sanitize an untrusted array of fields. Returns { ok, layout } / { ok:false, error }.
// De-dupes ids (regenerates on collision) so a client can't smuggle duplicate ids.
export function validateFieldLayout(rawLayout) {
  if (rawLayout == null) return { ok: true, layout: [] };
  if (!Array.isArray(rawLayout)) return { ok: false, error: 'field_layout must be an array' };
  if (rawLayout.length > 200) return { ok: false, error: 'too many fields (max 200)' };

  const seen = new Set();
  const layout = [];
  for (const raw of rawLayout) {
    const f = normalizeField(raw);
    if (!f) return { ok: false, error: 'invalid field in layout' };
    if (seen.has(f.id)) f.id = newFieldId();
    seen.add(f.id);
    layout.push(f);
  }
  return { ok: true, layout };
}

export function businessFields(layout = []) {
  return (layout || []).filter((f) => isBusinessRole(f.assigned_to));
}

// Keep only values that belong to a `business` field in the layout, coercing to
// a storable primitive (checkbox -> boolean, everything else -> trimmed string,
// capped at 2000 chars). Drops unknown keys so a client can't stash arbitrary
// data in field_values. Returns a plain object.
export function sanitizeFieldValues(layout = [], rawValues = {}) {
  const out = {};
  if (!rawValues || typeof rawValues !== 'object') return out;
  for (const f of businessFields(layout)) {
    if (!(f.id in rawValues)) continue;
    const v = rawValues[f.id];
    if (f.type === 'checkbox') {
      out[f.id] = v === true || v === 'true' || v === 'on' || v === '1' || v === 1;
    } else if (v == null) {
      out[f.id] = '';
    } else {
      out[f.id] = String(v).slice(0, 2000);
    }
  }
  return out;
}

export function signerFields(layout = []) {
  return (layout || []).filter((f) => isSignerRole(f.assigned_to));
}

// Distinct signer slot numbers referenced by the layout, ascending. e.g. [1, 2].
export function referencedSignerSlots(layout = []) {
  const slots = new Set();
  for (const f of layout || []) {
    const n = signerSlotIndex(f.assigned_to);
    if (n) slots.add(n);
  }
  return [...slots].sort((a, b) => a - b);
}

// Pre-send validation: every signer_N referenced by a field must have a
// corresponding signer in the signers array (by 1-based position/order).
// Returns { ok:true } or { ok:false, error }.
export function validateLayoutAgainstSigners(layout = [], signers = []) {
  const count = Array.isArray(signers) ? signers.length : 0;
  const slots = referencedSignerSlots(layout);
  const missing = slots.filter((n) => n > count);
  if (missing.length) {
    const names = missing.map((n) => `Signer ${n}`).join(', ');
    return {
      ok: false,
      error: `Field layout references ${names}, but only ${count} signer${count === 1 ? '' : 's'} added. Add the missing signer(s) or reassign those fields.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Coordinate transforms
// ---------------------------------------------------------------------------

// Editor pixels -> stored layout coords.
// The editor renders a page to an image of `renderScale` px per PDF point, with
// the origin at the TOP-LEFT of the image (standard screen coords). A dragged
// box is given as top-left px (px, py) plus px size (pw, ph). We convert to
// bottom-left PDF points. `pageHeightPts` is the page height in points.
export function screenBoxToLayout({ px, py, pw, ph, pageHeightPts, renderScale }) {
  const s = renderScale || 1;
  const width = pw / s;
  const height = ph / s;
  const x = px / s;
  const yTop = py / s; // distance from top of page, in points
  const y = pageHeightPts - yTop - height; // flip to bottom-left origin
  return { x, y, width, height };
}

// Stored layout coords -> editor pixels (inverse of screenBoxToLayout), so the
// editor can draw saved fields back onto the rendered page.
export function layoutBoxToScreen({ x, y, width, height, pageHeightPts, renderScale }) {
  const s = renderScale || 1;
  return {
    px: x * s,
    py: (pageHeightPts - y - height) * s,
    pw: width * s,
    ph: height * s,
  };
}

// A field's rectangle expressed in the system SignNow expects, honoring
// SIGNNOW_FIELD_Y_ORIGIN. Under the (documented, unverified) bottom-left
// assumption this is an identity on y. If SignNow turns out to be top-left,
// flipping the constant converts y to a top-origin distance here and NOWHERE
// else. Returns { x, y, width, height } as integers (SignNow wants whole units).
export function fieldRectForSignNow(field, pageHeightPts) {
  const width = Math.round(field.width);
  const height = Math.round(field.height);
  const x = Math.round(field.x);
  const y =
    SIGNNOW_FIELD_Y_ORIGIN === 'top-left'
      ? Math.round(pageHeightPts - field.y - field.height)
      : Math.round(field.y);
  return { x, y, width, height };
}

// SignNow's Fields API type vocabulary matches ours 1:1 for the four types we
// support (text/signature/initials/checkbox), so this is a pass-through today —
// kept as a seam so a future divergence has one place to change.
const SIGNNOW_FIELD_TYPE = {
  text: 'text',
  checkbox: 'checkbox',
  signature: 'signature',
  initials: 'initials',
};

// Build the `fields` payload for SignNow's PUT /document/{id}, covering ONLY the
// signer-fillable fields (business fields are baked into the PDF beforehand and
// must NOT become interactive SignNow fields). Each signer_N maps by position
// to role "Signer N". `pages` is [{ width, height }] indexed by page_number, so
// the y-origin transform can use the correct per-page height.
export function buildSignNowFields(layout = [], pages = []) {
  return signerFields(layout).map((f) => {
    const page = pages[f.page_number] || {};
    const pageHeightPts = Number(page.height) || 792;
    const rect = fieldRectForSignNow(f, pageHeightPts);
    const slot = signerSlotIndex(f.assigned_to);
    return {
      type: SIGNNOW_FIELD_TYPE[f.type] || 'text',
      name: f.id,
      role: `Signer ${slot}`,
      label: f.label,
      required: f.required !== false,
      page_number: f.page_number,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  });
}

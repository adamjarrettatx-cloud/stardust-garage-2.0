// Event Organizer + profile-first contract helpers.
//
// An "Event Organizer" is the person or legal entity throwing an event and the
// default legal counterparty / responsible signer for that event's contracts.
//
// It is NOT a new table. It is a value in contacts.contact_type, because
// events.contact_id, documents.contact_id and document_contracts.contact_id all
// already reference public.contacts, and partner_profiles already gives a
// contact an authenticated login. See
// supabase/migrations/20260830_event_organizer_contract_workflow.sql for the
// full rationale.
//
// Everything here is dependency-free and safe to import from client components:
// no service-role key, no server-only module, no network call.

import {
  businessFields,
  signerFields,
  referencedSignerSlots,
  signerSlotIndex,
} from './contract-fields.js';

export const EVENT_ORGANIZER_TYPE = 'event_organizer';

// The counterparty types that behave as a legal counterparty on an agreement,
// and therefore get the legal-counterparty fieldset (legal name, entity type,
// address, default signer) on the contact form. Event Organizer is the primary
// one; the others already sign agreements with SDG today.
export const LEGAL_COUNTERPARTY_TYPES = [
  EVENT_ORGANIZER_TYPE,
  'venue_renter',
  'promoter',
  'collective',
  'vendor',
];

export const ENTITY_TYPE_OPTIONS = [
  { value: 'individual', label: 'Individual' },
  { value: 'business', label: 'Business / Entity' },
];

// contract_templates.kind — see the migration's CHECK constraint.
export const TEMPLATE_KINDS = [
  {
    value: 'master',
    label: 'Master Agreement',
    hint: 'Open-ended relationship agreement with an Event Organizer.',
  },
  {
    value: 'event',
    label: 'Event Agreement',
    hint: 'Event-specific agreement or addendum, optionally under a Master Agreement.',
  },
  { value: 'other', label: 'Other', hint: 'Anything else.' },
];

export const TEMPLATE_KIND_VALUES = new Set(TEMPLATE_KINDS.map((k) => k.value));

export function templateKindLabel(value) {
  return TEMPLATE_KINDS.find((k) => k.value === value)?.label || value || 'Other';
}

// Signer slot -> the role label staff and the recipient both see. signer_1 is
// always the Event Organizer for an event-related contract; the remaining slots
// are generic additional signers.
export const SIGNER_SLOT_LABELS = {
  1: 'Event Organizer',
  2: 'Additional Signer',
  3: 'Additional Signer',
  4: 'Additional Signer',
};

export function signerSlotLabel(assignedTo) {
  const slot = signerSlotIndex(assignedTo);
  if (!slot) return null;
  return SIGNER_SLOT_LABELS[slot] || `Signer ${slot}`;
}

function types(contact) {
  const t = contact?.contact_type;
  if (Array.isArray(t)) return t.filter(Boolean);
  if (typeof t === 'string' && t) return [t];
  return [];
}

export function isEventOrganizer(contact) {
  return types(contact).includes(EVENT_ORGANIZER_TYPE);
}

// Does this contact type set warrant the legal-counterparty fieldset?
export function needsLegalCounterpartyFields(contactType) {
  const list = Array.isArray(contactType)
    ? contactType
    : typeof contactType === 'string' && contactType
      ? [contactType]
      : [];
  return list.some((t) => LEGAL_COUNTERPARTY_TYPES.includes(t));
}

export function isArchivedContact(contact) {
  return contact?.status === 'archived';
}

// The name that belongs on the agreement: legal name if we have one, otherwise
// the operational display name. Never returns null for a valid contact.
export function organizerLegalName(contact) {
  const legal = String(contact?.legal_name || '').trim();
  if (legal) return legal;
  return String(contact?.display_name || '').trim();
}

// Human label for the organizer as shown next to a contract, e.g.
// "Bassment Sessions LLC (dba Bassment Sessions)".
export function organizerDisplayLabel(contact) {
  if (!contact) return '';
  const display = String(contact.display_name || '').trim();
  const legal = String(contact.legal_name || '').trim();
  if (legal && display && legal !== display) return `${legal} (dba ${display})`;
  return legal || display;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The email a contract invite should go to for this contact: the explicit
// default signer email, else the contact's own email. Returns null when neither
// is usable, which is what blocks sending.
export function defaultSignerEmail(contact) {
  for (const candidate of [contact?.default_signer_email, contact?.email]) {
    const e = String(candidate || '').trim().toLowerCase();
    if (e && EMAIL_RE.test(e)) return e;
  }
  return null;
}

// The human name to prefill on the signature: explicit default signer, else the
// named primary contact, else the legal/display name of the entity itself.
export function defaultSignerName(contact) {
  for (const candidate of [
    contact?.default_signer_name,
    contact?.primary_contact_name,
    organizerLegalName(contact),
  ]) {
    const n = String(candidate || '').trim();
    if (n) return n;
  }
  return '';
}

// Build the signer_1 entry for a contract from an Event Organizer contact, in
// the exact shape lib/contract-helpers.js normalizeSigner() produces so the
// existing validateSigners() and SignNow role mapping accept it unchanged.
// Returns null when the contact cannot be a signer (no usable email).
export function organizerSigner(contact) {
  const email = defaultSignerEmail(contact);
  const name = defaultSignerName(contact);
  if (!email || !name) return null;
  return {
    name,
    email,
    role: 'signer',
    order: 1,
    status: 'pending',
    signed_at: null,
  };
}

// ---------------------------------------------------------------------------
// Contact write validation (legal-counterparty fields)
// ---------------------------------------------------------------------------

export const ORGANIZER_TEXT_FIELDS = [
  'legal_name',
  'address_line1',
  'address_line2',
  'address_city',
  'address_state',
  'address_postal_code',
  'address_country',
  'default_signer_name',
];

// Sanitize the legal-counterparty half of a contact payload. Returns
// { ok: true, patch } or { ok: false, error }. Empty strings become null so an
// unfilled field never stores whitespace.
export function buildOrganizerPatch(body = {}) {
  const patch = {};

  for (const key of ORGANIZER_TEXT_FIELDS) {
    if (key in body) {
      patch[key] = String(body[key] ?? '').trim().slice(0, 300) || null;
    }
  }

  if ('entity_type' in body) {
    const raw = String(body.entity_type || '').trim();
    if (!raw) patch.entity_type = null;
    else if (raw === 'individual' || raw === 'business') patch.entity_type = raw;
    else return { ok: false, error: 'entity_type must be individual or business' };
  }

  if ('default_signer_email' in body) {
    const raw = String(body.default_signer_email || '').trim().toLowerCase();
    if (!raw) patch.default_signer_email = null;
    else if (!EMAIL_RE.test(raw)) return { ok: false, error: 'invalid default_signer_email' };
    else patch.default_signer_email = raw;
  }

  return { ok: true, patch };
}

// ---------------------------------------------------------------------------
// Create-contract setup validation
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f-]{36}$/i;

function optionalUuid(value) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value === 'string' && UUID_RE.test(value)) return { ok: true, value };
  return { ok: false };
}

// Validate the "Create Contract" setup step from an Event page.
//
// Rules enforced here (and re-enforced server-side by the route):
//   * a template must be chosen
//   * the event must be present and locked to the contract
//   * a primary Event Organizer contact must be present
//   * an event template flagged requires_master must name a Master Agreement
//   * expiration, if given, must be after effective
//
// `template` is the contract_templates row (or a subset with kind /
// requires_master). Returns { ok: true, setup } or { ok: false, error }.
export function validateContractSetup({
  template = null,
  eventId = null,
  organizerContactId = null,
  masterContractId = null,
  artistContactId = null,
  collectiveContactId = null,
  vendorContactId = null,
  ownerUserId = null,
  effectiveDate = null,
  expirationDate = null,
} = {}) {
  if (!template || !UUID_RE.test(String(template.id || ''))) {
    return { ok: false, error: 'Choose a contract template.' };
  }

  const event = optionalUuid(eventId);
  if (!event.ok) return { ok: false, error: 'invalid event_id' };
  if (!event.value) {
    return { ok: false, error: 'An event is required — start from the Event page.' };
  }

  const organizer = optionalUuid(organizerContactId);
  if (!organizer.ok) return { ok: false, error: 'invalid organizer contact id' };
  if (!organizer.value) {
    return {
      ok: false,
      error:
        'This event has no Event Organizer. Link an Event Organizer on the event before creating a contract.',
    };
  }

  const master = optionalUuid(masterContractId);
  if (!master.ok) return { ok: false, error: 'invalid master_contract_id' };
  if (template.kind === 'event' && template.requires_master && !master.value) {
    return {
      ok: false,
      error:
        'This Event Agreement template requires an applicable Master Agreement. Select the organizer’s Master Agreement, or send their Master Agreement first.',
    };
  }
  // A Master Agreement is a relationship-level document; it never hangs off
  // another Master Agreement.
  if (template.kind === 'master' && master.value) {
    return { ok: false, error: 'A Master Agreement cannot reference another Master Agreement.' };
  }

  const optional = {};
  for (const [key, value] of Object.entries({
    artist_contact_id: artistContactId,
    collective_contact_id: collectiveContactId,
    vendor_contact_id: vendorContactId,
    owner_user_id: ownerUserId,
  })) {
    const res = optionalUuid(value);
    if (!res.ok) return { ok: false, error: `invalid ${key}` };
    optional[key] = res.value;
  }

  if (effectiveDate && expirationDate) {
    const from = Date.parse(effectiveDate);
    const to = Date.parse(expirationDate);
    if (Number.isFinite(from) && Number.isFinite(to) && to <= from) {
      return { ok: false, error: 'Expiration must be after the effective date.' };
    }
  }

  return {
    ok: true,
    setup: {
      template_id: template.id,
      event_id: event.value,
      contact_id: organizer.value,
      master_contract_id: master.value,
      ...optional,
    },
  };
}

// ---------------------------------------------------------------------------
// Pre-send readiness
// ---------------------------------------------------------------------------

// Is a business field's stored value complete? Checkboxes must be true when
// required; everything else needs non-whitespace text.
function businessValueMissing(field, values) {
  const v = values?.[field.id];
  if (field.type === 'checkbox') return v !== true;
  return String(v ?? '').trim() === '';
}

// The single pre-send gate for a contract, used by the API route AND rendered as
// the review state in the UI so staff see exactly what the server will enforce.
//
// Returns { ok: true, warnings } or { ok: false, errors, warnings } where errors
// is an ordered list of human-readable blockers. Never throws.
export function contractSendReadiness({
  contract = null,
  organizer = null,
  template = null,
} = {}) {
  const errors = [];
  const warnings = [];

  if (!contract) return { ok: false, errors: ['No contract record yet.'], warnings };

  const layout = Array.isArray(contract.field_layout) ? contract.field_layout : [];
  const values =
    contract.field_values && typeof contract.field_values === 'object' ? contract.field_values : {};
  const signers = Array.isArray(contract.signers) ? contract.signers : [];

  // 1. Event Organizer must be present and usable as a signer.
  if (!contract.contact_id) {
    errors.push('No Event Organizer linked to this contract.');
  } else if (organizer) {
    if (isArchivedContact(organizer)) {
      errors.push(
        `${organizerDisplayLabel(organizer)} is archived. Reactivate the profile or choose a different Event Organizer.`,
      );
    }
    if (!defaultSignerEmail(organizer)) {
      errors.push(
        `${organizerDisplayLabel(organizer) || 'The Event Organizer'} has no signer email. Add an email or a default signer email on their profile.`,
      );
    }
  }

  // 2. Master Agreement reference, when the template demands one.
  if (template?.kind === 'event' && template?.requires_master && !contract.master_contract_id) {
    errors.push('This Event Agreement requires an applicable Master Agreement to be selected.');
  }

  // 3. Required business fields must be filled — these are baked into the PDF
  //    before send, so a blank one ships a blank contract.
  const missingBusiness = businessFields(layout).filter(
    (f) => f.required !== false && businessValueMissing(f, values),
  );
  if (missingBusiness.length) {
    const names = missingBusiness.slice(0, 5).map((f) => f.label).join(', ');
    const more = missingBusiness.length > 5 ? ` (+${missingBusiness.length - 5} more)` : '';
    errors.push(`Fill the required Stardust fields before sending: ${names}${more}.`);
  }

  // 4. Every signer slot referenced by a field needs a real signer behind it.
  const slots = referencedSignerSlots(layout);
  const missingSlots = slots.filter((n) => n > signers.length);
  if (missingSlots.length) {
    errors.push(
      `Fields are assigned to ${missingSlots
        .map((n) => SIGNER_SLOT_LABELS[n] || `Signer ${n}`)
        .join(', ')}, but no such signer is set. Add the signer or reassign those fields.`,
    );
  }

  // 5. At least one signer.
  if (signers.length === 0) {
    errors.push('Add at least one signer before sending.');
  }

  // 6. Advisory: a layout with no signer field will produce a document nobody
  //    can actually sign, but SignNow still accepts it, so warn rather than block.
  if (layout.length && signerFields(layout).length === 0) {
    warnings.push('No signature fields are assigned to the Event Organizer — they will receive a document with nothing to fill in.');
  }
  if (!layout.length) {
    warnings.push('No field layout on this contract — it will be sent as a plain document with no placed fields.');
  }
  if (contract.expiration_date) {
    const to = Date.parse(contract.expiration_date);
    if (Number.isFinite(to) && to <= Date.now()) {
      warnings.push('The expiration date is already in the past.');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

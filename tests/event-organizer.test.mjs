import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_ORGANIZER_TYPE,
  TEMPLATE_KIND_VALUES,
  templateKindLabel,
  signerSlotLabel,
  isEventOrganizer,
  needsLegalCounterpartyFields,
  isArchivedContact,
  organizerLegalName,
  organizerDisplayLabel,
  defaultSignerEmail,
  defaultSignerName,
  organizerSigner,
  buildOrganizerPatch,
  validateContractSetup,
  contractSendReadiness,
} from '../lib/event-organizer.js';
import { validateSigners } from '../lib/contract-helpers.js';

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const EVENT_ID = '22222222-2222-2222-2222-222222222222';
const TEMPLATE_ID = '33333333-3333-3333-3333-333333333333';
const MASTER_ID = '44444444-4444-4444-4444-444444444444';

const organizer = {
  id: ORG_ID,
  display_name: 'Bassment Sessions',
  legal_name: 'Bassment Sessions LLC',
  contact_type: [EVENT_ORGANIZER_TYPE],
  status: 'active',
  email: 'booking@bassment.example',
  primary_contact_name: 'Rae Ortiz',
};

// ---------------------------------------------------------------------------
// Type + label helpers
// ---------------------------------------------------------------------------

test('isEventOrganizer reads the contact_type array, string or missing', () => {
  assert.equal(isEventOrganizer(organizer), true);
  assert.equal(isEventOrganizer({ contact_type: 'event_organizer' }), true);
  assert.equal(isEventOrganizer({ contact_type: ['dj', 'artist'] }), false);
  assert.equal(isEventOrganizer({}), false);
  assert.equal(isEventOrganizer(null), false);
});

test('needsLegalCounterpartyFields covers signing counterparties only', () => {
  assert.equal(needsLegalCounterpartyFields(['event_organizer']), true);
  assert.equal(needsLegalCounterpartyFields(['vendor']), true);
  assert.equal(needsLegalCounterpartyFields('promoter'), true);
  assert.equal(needsLegalCounterpartyFields(['dj', 'resident']), false);
  assert.equal(needsLegalCounterpartyFields(undefined), false);
});

test('TEMPLATE_KIND_VALUES is a Set and labels resolve', () => {
  // Guards the API routes, which validate with .has() — an array would silently
  // accept nothing.
  assert.ok(TEMPLATE_KIND_VALUES instanceof Set);
  assert.equal(TEMPLATE_KIND_VALUES.has('master'), true);
  assert.equal(TEMPLATE_KIND_VALUES.has('event'), true);
  assert.equal(TEMPLATE_KIND_VALUES.has('other'), true);
  assert.equal(TEMPLATE_KIND_VALUES.has('bogus'), false);
  assert.equal(templateKindLabel('master'), 'Master Agreement');
  assert.equal(templateKindLabel('event'), 'Event Agreement');
  assert.equal(templateKindLabel(null), 'Other');
});

test('signerSlotLabel names slot 1 the Event Organizer', () => {
  assert.equal(signerSlotLabel('signer_1'), 'Event Organizer');
  assert.equal(signerSlotLabel('signer_2'), 'Additional Signer');
  assert.equal(signerSlotLabel('business'), null);
  assert.equal(signerSlotLabel('nonsense'), null);
});

test('isArchivedContact', () => {
  assert.equal(isArchivedContact({ status: 'archived' }), true);
  assert.equal(isArchivedContact({ status: 'active' }), false);
  assert.equal(isArchivedContact(null), false);
});

// ---------------------------------------------------------------------------
// Names + signer derivation
// ---------------------------------------------------------------------------

test('organizerLegalName prefers the legal name, falls back to display name', () => {
  assert.equal(organizerLegalName(organizer), 'Bassment Sessions LLC');
  assert.equal(organizerLegalName({ display_name: 'Just A Name' }), 'Just A Name');
  assert.equal(organizerLegalName({ legal_name: '   ', display_name: 'Trimmed' }), 'Trimmed');
});

test('organizerDisplayLabel shows dba only when the names differ', () => {
  assert.equal(organizerDisplayLabel(organizer), 'Bassment Sessions LLC (dba Bassment Sessions)');
  assert.equal(organizerDisplayLabel({ display_name: 'Same', legal_name: 'Same' }), 'Same');
  assert.equal(organizerDisplayLabel({ display_name: 'Only Display' }), 'Only Display');
  assert.equal(organizerDisplayLabel(null), '');
});

test('defaultSignerEmail prefers the explicit signer email and validates it', () => {
  assert.equal(defaultSignerEmail(organizer), 'booking@bassment.example');
  assert.equal(
    defaultSignerEmail({ ...organizer, default_signer_email: 'Rae@Bassment.Example' }),
    'rae@bassment.example',
  );
  // A malformed override must not silently win over nothing — it is skipped and
  // the usable contact email is used instead.
  assert.equal(defaultSignerEmail({ ...organizer, default_signer_email: 'not-an-email' }), 'booking@bassment.example');
  assert.equal(defaultSignerEmail({ display_name: 'No Email' }), null);
});

test('defaultSignerName falls back signer -> primary contact -> entity name', () => {
  assert.equal(defaultSignerName({ ...organizer, default_signer_name: 'Rae O.' }), 'Rae O.');
  assert.equal(defaultSignerName(organizer), 'Rae Ortiz');
  assert.equal(defaultSignerName({ legal_name: 'Entity Only LLC' }), 'Entity Only LLC');
  assert.equal(defaultSignerName({}), '');
});

test('organizerSigner produces a signer the existing validateSigners accepts', () => {
  const signer = organizerSigner(organizer);
  assert.equal(signer.email, 'booking@bassment.example');
  assert.equal(signer.name, 'Rae Ortiz');
  assert.equal(signer.order, 1);
  const res = validateSigners([signer]);
  assert.equal(res.ok, true, JSON.stringify(res));
});

test('organizerSigner returns null when the contact cannot sign', () => {
  assert.equal(organizerSigner({ display_name: 'No Email Co' }), null);
  assert.equal(organizerSigner(null), null);
});

// ---------------------------------------------------------------------------
// Contact write validation
// ---------------------------------------------------------------------------

test('buildOrganizerPatch normalizes blanks to null and only touches sent keys', () => {
  const { ok, patch } = buildOrganizerPatch({
    legal_name: '  Bassment Sessions LLC  ',
    address_line1: '',
    entity_type: 'business',
    default_signer_email: '  Rae@Bassment.Example ',
  });
  assert.equal(ok, true);
  assert.equal(patch.legal_name, 'Bassment Sessions LLC');
  assert.equal(patch.address_line1, null);
  assert.equal(patch.entity_type, 'business');
  assert.equal(patch.default_signer_email, 'rae@bassment.example');
  // Keys absent from the body must not be written, so a partial form submit
  // can't wipe fields it never rendered.
  assert.equal('address_city' in patch, false);
  assert.equal('default_signer_name' in patch, false);
});

test('buildOrganizerPatch rejects bad enum and bad email', () => {
  assert.equal(buildOrganizerPatch({ entity_type: 'llc' }).ok, false);
  assert.equal(buildOrganizerPatch({ default_signer_email: 'nope@' }).ok, false);
  // Explicit clearing is allowed.
  assert.deepEqual(buildOrganizerPatch({ entity_type: '' }).patch, { entity_type: null });
});

// ---------------------------------------------------------------------------
// Create-contract setup validation
// ---------------------------------------------------------------------------

test('validateContractSetup accepts a complete event-agreement setup', () => {
  const res = validateContractSetup({
    template: { id: TEMPLATE_ID, kind: 'event', requires_master: true },
    eventId: EVENT_ID,
    organizerContactId: ORG_ID,
    masterContractId: MASTER_ID,
  });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.setup, {
    template_id: TEMPLATE_ID,
    event_id: EVENT_ID,
    contact_id: ORG_ID,
    master_contract_id: MASTER_ID,
    artist_contact_id: null,
    collective_contact_id: null,
    vendor_contact_id: null,
    owner_user_id: null,
  });
});

test('validateContractSetup requires a template, an event and an organizer', () => {
  assert.equal(validateContractSetup({}).ok, false);
  assert.match(
    validateContractSetup({ template: { id: TEMPLATE_ID, kind: 'other' } }).error,
    /event is required/i,
  );
  assert.match(
    validateContractSetup({
      template: { id: TEMPLATE_ID, kind: 'other' },
      eventId: EVENT_ID,
    }).error,
    /no Event Organizer/i,
  );
});

test('validateContractSetup enforces the Master Agreement relationship', () => {
  // requires_master with nothing selected is a blocker...
  const missing = validateContractSetup({
    template: { id: TEMPLATE_ID, kind: 'event', requires_master: true },
    eventId: EVENT_ID,
    organizerContactId: ORG_ID,
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Master Agreement/);

  // ...and a Master Agreement never hangs off another Master Agreement.
  const nested = validateContractSetup({
    template: { id: TEMPLATE_ID, kind: 'master' },
    eventId: EVENT_ID,
    organizerContactId: ORG_ID,
    masterContractId: MASTER_ID,
  });
  assert.equal(nested.ok, false);
  assert.match(nested.error, /cannot reference another Master Agreement/);
});

test('validateContractSetup rejects malformed ids and inverted dates', () => {
  assert.match(
    validateContractSetup({
      template: { id: TEMPLATE_ID, kind: 'other' },
      eventId: 'not-a-uuid',
      organizerContactId: ORG_ID,
    }).error,
    /invalid event_id/,
  );
  assert.match(
    validateContractSetup({
      template: { id: TEMPLATE_ID, kind: 'other' },
      eventId: EVENT_ID,
      organizerContactId: ORG_ID,
      effectiveDate: '2026-09-01T00:00:00.000Z',
      expirationDate: '2026-08-01T00:00:00.000Z',
    }).error,
    /Expiration must be after/,
  );
});

// ---------------------------------------------------------------------------
// Pre-send readiness — the gate the send route enforces
// ---------------------------------------------------------------------------

// Stored layout shape, exactly as lib/contract-fields.js normalizeField() emits
// it: page_number / width / height, bottom-left origin, f_ prefixed ids.
const readyLayout = [
  { id: 'f_fee', type: 'text', label: 'Fee', page_number: 0, x: 10, y: 10, width: 100, height: 20, required: true, assigned_to: 'business' },
  { id: 'f_sig', type: 'signature', label: 'Sign', page_number: 0, x: 10, y: 60, width: 160, height: 40, required: true, assigned_to: 'signer_1' },
];

function readyContract(overrides = {}) {
  return {
    contact_id: ORG_ID,
    master_contract_id: MASTER_ID,
    field_layout: readyLayout,
    field_values: { f_fee: '$1,500' },
    signers: [organizerSigner(organizer)],
    ...overrides,
  };
}

test('contractSendReadiness passes a fully prepared contract', () => {
  const res = contractSendReadiness({
    contract: readyContract(),
    organizer,
    template: { kind: 'event', requires_master: true },
  });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.warnings, []);
});

test('contractSendReadiness blocks a missing or unusable organizer', () => {
  const none = contractSendReadiness({ contract: readyContract({ contact_id: null }), organizer: null });
  assert.equal(none.ok, false);
  assert.match(none.errors.join(' '), /No Event Organizer linked/);

  const archived = contractSendReadiness({
    contract: readyContract(),
    organizer: { ...organizer, status: 'archived' },
  });
  assert.equal(archived.ok, false);
  assert.match(archived.errors.join(' '), /archived/);

  const noEmail = contractSendReadiness({
    contract: readyContract(),
    organizer: { id: ORG_ID, display_name: 'No Email Co', status: 'active' },
  });
  assert.equal(noEmail.ok, false);
  assert.match(noEmail.errors.join(' '), /no signer email/i);
});

test('contractSendReadiness blocks a missing Master Agreement reference', () => {
  const res = contractSendReadiness({
    contract: readyContract({ master_contract_id: null }),
    organizer,
    template: { kind: 'event', requires_master: true },
  });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /requires an applicable Master Agreement/);
});

test('contractSendReadiness blocks unfilled required business fields', () => {
  const res = contractSendReadiness({
    contract: readyContract({ field_values: { f_fee: '   ' } }),
    organizer,
  });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /Fill the required Stardust fields/);
  assert.match(res.errors.join(' '), /Fee/);
});

test('contractSendReadiness blocks fields pointing at a signer who does not exist', () => {
  const res = contractSendReadiness({
    contract: readyContract({
      field_layout: [
        ...readyLayout,
        { id: 'f_cosign', type: 'signature', label: 'Co-sign', page_number: 0, x: 10, y: 120, width: 160, height: 40, required: true, assigned_to: 'signer_3' },
      ],
    }),
    organizer,
  });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /Additional Signer/);
});

test('contractSendReadiness blocks a contract with no signers, and no contract at all', () => {
  const noSigners = contractSendReadiness({ contract: readyContract({ signers: [] }), organizer });
  assert.equal(noSigners.ok, false);
  assert.match(noSigners.errors.join(' '), /at least one signer/i);

  const nothing = contractSendReadiness({});
  assert.equal(nothing.ok, false);
  assert.match(nothing.errors.join(' '), /No contract record/);
});

test('contractSendReadiness warns without blocking on soft problems', () => {
  // No signature field anywhere: SignNow accepts it, so warn.
  const noSigField = contractSendReadiness({
    contract: readyContract({ field_layout: [readyLayout[0]] }),
    organizer,
  });
  assert.equal(noSigField.ok, true);
  assert.match(noSigField.warnings.join(' '), /No signature fields/);

  const noLayout = contractSendReadiness({
    contract: readyContract({ field_layout: [], field_values: {} }),
    organizer,
  });
  assert.equal(noLayout.ok, true);
  assert.match(noLayout.warnings.join(' '), /No field layout/);

  const expired = contractSendReadiness({
    contract: readyContract({ expiration_date: '2020-01-01T00:00:00.000Z' }),
    organizer,
  });
  assert.equal(expired.ok, true);
  assert.match(expired.warnings.join(' '), /already in the past/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD_TYPES,
  MAX_SIGNER_SLOTS,
  ASSIGNABLE_ROLES,
  roleLabel,
  roleColor,
  signerSlotIndex,
  isSignerRole,
  isBusinessRole,
  newFieldId,
  normalizeField,
  validateFieldLayout,
  businessFields,
  signerFields,
  referencedSignerSlots,
  validateLayoutAgainstSigners,
  screenBoxToLayout,
  layoutBoxToScreen,
  fieldRectForSignNow,
  SIGNNOW_FIELD_Y_ORIGIN,
  buildSignNowFields,
} from '../lib/contract-fields.js';

test('ASSIGNABLE_ROLES = business + signer_1..N', () => {
  assert.equal(ASSIGNABLE_ROLES[0], 'business');
  assert.equal(ASSIGNABLE_ROLES.length, MAX_SIGNER_SLOTS + 1);
  assert.ok(ASSIGNABLE_ROLES.includes(`signer_${MAX_SIGNER_SLOTS}`));
});

test('role helpers', () => {
  assert.equal(roleLabel('business'), 'Business');
  assert.equal(roleLabel('signer_2'), 'Signer 2');
  assert.equal(signerSlotIndex('signer_3'), 3);
  assert.equal(signerSlotIndex('business'), null);
  assert.equal(isSignerRole('signer_1'), true);
  assert.equal(isSignerRole('business'), false);
  assert.equal(isBusinessRole('business'), true);
  assert.notEqual(roleColor('business'), roleColor('signer_1'));
});

test('newFieldId is unique and matches the id pattern', () => {
  const a = newFieldId();
  const b = newFieldId();
  assert.notEqual(a, b);
  assert.match(a, /^f_[a-z0-9]+$/i);
});

test('normalizeField rejects bad type/role/geometry', () => {
  assert.equal(normalizeField(null), null);
  assert.equal(normalizeField({ type: 'nope', assigned_to: 'business', width: 1, height: 1 }), null);
  assert.equal(normalizeField({ type: 'text', assigned_to: 'signer_9', width: 1, height: 1 }), null);
  assert.equal(normalizeField({ type: 'text', assigned_to: 'business', width: 0, height: 10 }), null);
});

test('normalizeField coerces and defaults', () => {
  const f = normalizeField({
    type: 'text',
    assigned_to: 'signer_1',
    x: 10.123, y: 20.9, width: 100.5, height: 20,
    page_number: 2.8,
  });
  assert.equal(f.type, 'text');
  assert.equal(f.assigned_to, 'signer_1');
  assert.equal(f.page_number, 2); // truncated
  assert.equal(f.x, 10.12); // rounded 2dp
  assert.equal(f.required, true); // defaults required
  assert.equal(f.label, 'Signer 1'); // derived from role when blank
  assert.match(f.id, /^f_/);
});

test('normalizeField keeps a valid client id but regenerates a bad one', () => {
  const good = normalizeField({ id: 'f_abc123', type: 'text', assigned_to: 'business', width: 5, height: 5 });
  assert.equal(good.id, 'f_abc123');
  const bad = normalizeField({ id: 'evil id!', type: 'text', assigned_to: 'business', width: 5, height: 5 });
  assert.match(bad.id, /^f_[a-z0-9]+$/i);
});

test('validateFieldLayout sanitizes and de-dupes ids', () => {
  assert.deepEqual(validateFieldLayout(null), { ok: true, layout: [] });
  assert.equal(validateFieldLayout('nope').ok, false);

  const res = validateFieldLayout([
    { id: 'f_dup', type: 'text', assigned_to: 'business', x: 1, y: 1, width: 10, height: 10 },
    { id: 'f_dup', type: 'checkbox', assigned_to: 'signer_1', x: 2, y: 2, width: 10, height: 10 },
  ]);
  assert.ok(res.ok);
  assert.equal(res.layout.length, 2);
  assert.notEqual(res.layout[0].id, res.layout[1].id);
});

test('validateFieldLayout fails on an invalid field', () => {
  const res = validateFieldLayout([{ type: 'bogus' }]);
  assert.equal(res.ok, false);
});

test('business/signer partitioning + referenced slots', () => {
  const layout = [
    { id: 'f_1', type: 'text', assigned_to: 'business', x: 0, y: 0, width: 1, height: 1 },
    { id: 'f_2', type: 'signature', assigned_to: 'signer_1', x: 0, y: 0, width: 1, height: 1 },
    { id: 'f_3', type: 'text', assigned_to: 'signer_2', x: 0, y: 0, width: 1, height: 1 },
  ];
  assert.equal(businessFields(layout).length, 1);
  assert.equal(signerFields(layout).length, 2);
  assert.deepEqual(referencedSignerSlots(layout), [1, 2]);
});

test('validateLayoutAgainstSigners enforces slot coverage', () => {
  const layout = [{ id: 'f_1', type: 'signature', assigned_to: 'signer_2', x: 0, y: 0, width: 1, height: 1 }];
  assert.equal(validateLayoutAgainstSigners(layout, [{}]).ok, false); // only 1 signer, needs 2
  assert.equal(validateLayoutAgainstSigners(layout, [{}, {}]).ok, true);
  assert.equal(validateLayoutAgainstSigners([], []).ok, true); // no fields, fine
});

test('screen<->layout round trip is stable', () => {
  const pageHeightPts = 792;
  const renderScale = 2;
  const box = { px: 120, py: 80, pw: 200, ph: 40, pageHeightPts, renderScale };
  const layout = screenBoxToLayout(box);
  // top-left 80px at scale 2 = 40pt from top; bottom-left y = 792 - 40 - 20 = 732
  assert.equal(layout.x, 60);
  assert.equal(layout.width, 100);
  assert.equal(layout.height, 20);
  assert.equal(layout.y, 792 - 40 - 20);

  const back = layoutBoxToScreen({ ...layout, pageHeightPts, renderScale });
  assert.equal(back.px, box.px);
  assert.equal(back.py, box.py);
  assert.equal(back.pw, box.pw);
  assert.equal(back.ph, box.ph);
});

test('SignNow y-origin is top-left (empirically confirmed)', () => {
  assert.equal(SIGNNOW_FIELD_Y_ORIGIN, 'top-left');
});

test('fieldRectForSignNow flips stored bottom-left y to SignNow top-left', () => {
  const field = { x: 50, y: 700, width: 200, height: 20 };
  const rect = fieldRectForSignNow(field, 792);
  // stored y=700 is the bottom edge from the page bottom; top edge from the
  // page top = 792 - 700 - 20 = 72.
  assert.deepEqual(rect, { x: 50, y: 72, width: 200, height: 20 });
});

// ---------------------------------------------------------------------------
// The `date` field type
// ---------------------------------------------------------------------------

test('date is a first-class field type alongside the original four', () => {
  assert.deepEqual(FIELD_TYPES, ['text', 'date', 'checkbox', 'signature', 'initials']);
});

test('normalizeField and validateFieldLayout accept a date field', () => {
  const field = normalizeField({
    id: 'f_d1',
    page_number: 0,
    x: 20,
    y: 40,
    width: 120,
    height: 22,
    type: 'date',
    label: 'Event date',
    assigned_to: 'signer_1',
  });
  assert.equal(field.type, 'date');

  const res = validateFieldLayout([field]);
  assert.equal(res.ok, true, JSON.stringify(res));
});

test('a date field is sent to SignNow as text', () => {
  // SignNow has no first-class date field in the shape we PUT, so the date-ness
  // is ours to enforce and the wire type degrades to text rather than risking a
  // rejected send.
  const layout = [
    normalizeField({ id: 'f_d1', page_number: 0, x: 20, y: 40, width: 120, height: 22, type: 'date', label: 'Event date', assigned_to: 'signer_1' }),
    normalizeField({ id: 'f_s1', page_number: 0, x: 20, y: 100, width: 160, height: 40, type: 'signature', label: 'Sign', assigned_to: 'signer_1' }),
  ];
  const fields = buildSignNowFields(layout, [{ width: 612, height: 792 }]);
  const date = fields.find((f) => f.name === 'f_d1');
  assert.equal(date.type, 'text');
  assert.equal(date.role, 'Signer 1');
  // The signature field is untouched by the mapping.
  assert.equal(fields.find((f) => f.name === 'f_s1').type, 'signature');
});

test('a business-assigned date never becomes an interactive SignNow field', () => {
  // Business values are baked into the PDF before send; exposing them as fields
  // would let the counterparty edit our own terms.
  const layout = [
    normalizeField({ id: 'f_b1', page_number: 0, x: 20, y: 40, width: 120, height: 22, type: 'date', label: 'Effective', assigned_to: 'business' }),
  ];
  assert.deepEqual(buildSignNowFields(layout, [{ width: 612, height: 792 }]), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEW_PERSONAS, VIEW_GROUP_DESCRIPTIONS, viewOptions, viewPersona, personaEmail } from '../lib/view-portal/personas.js';

test('Persons uses exact requested wording and includes both person partner roles', () => {
  assert.equal(viewPersona('artist').group, 'Persons');
  assert.equal(viewPersona('promoter').group, 'Persons');
  assert.ok(!VIEW_PERSONAS.some((p) => p.group === 'People' || p.group === 'Partner'));
});

test('Organizations is one selectable type with two existing test scenarios', () => {
  const organizations = viewOptions().filter((option) => option.group === 'Organizations');
  assert.equal(organizations.length, 1);
  assert.equal(organizations[0].label, 'Organization');
  assert.deepEqual(organizations[0].scenarios.map((p) => [p.id, p.scenario]), [
    ['collective', 'Collective'], ['organizer', 'Event Organizer'],
  ]);
});

test('grouping preserves every fixed identity exactly once and creates no new login type', () => {
  const before = JSON.stringify(VIEW_PERSONAS);
  const flattened = viewOptions().flatMap((option) => option.scenarios);
  assert.equal(flattened.length, 20);
  assert.equal(new Set(flattened.map((p) => p.id)).size, 20);
  for (const p of flattened) {
    assert.equal(p, viewPersona(p.id));
    assert.equal(personaEmail(p.id), `view-${p.id}@preview.sdgatx.invalid`);
  }
  assert.equal(viewPersona('organization'), null);
  assert.equal(viewPersona('owner'), null);
  assert.equal(JSON.stringify(VIEW_PERSONAS), before);
});

test('organization scenarios retain partner tags and restricted lifecycle cases stay separate', () => {
  assert.deepEqual(viewPersona('collective').partner, ['collective']);
  assert.deepEqual(viewPersona('organizer').partner, ['event_organizer']);
  assert.equal(viewPersona('collective').path, '/portal/profile');
  assert.equal(viewPersona('organizer').path, '/portal/profile');
  assert.equal(viewPersona('invited-partner').partnerState, 'invited');
  assert.equal(viewPersona('disabled-partner').partnerState, 'disabled');
  assert.match(VIEW_GROUP_DESCRIPTIONS.Organizations, /grants no login access or signing authority/);
});

test('grouping respects an explicitly supplied reduced catalog', () => {
  assert.deepEqual(viewOptions([]), []);
  const options = viewOptions([viewPersona('organizer')]);
  assert.equal(options.length, 1);
  assert.deepEqual(options[0].scenarios.map((p) => p.id), ['organizer']);
});

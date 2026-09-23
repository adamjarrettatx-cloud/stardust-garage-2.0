import test from 'node:test';
import assert from 'node:assert/strict';
import { contactProfileKind, validateMainContactRequest } from '../lib/contact-organizations.js';
import { contactDirectoryTypes, toggleContactType } from '../lib/contact-helpers.js';
import { needsLegalCounterpartyFields } from '../lib/event-organizer.js';

test('legacy organization tags merge without duplicate sections or mutation', () => {
  const tags = Object.freeze(['event_organizer','collective','organization']);
  assert.deepEqual(contactDirectoryTypes(tags), ['organization']);
  assert.deepEqual(toggleContactType(tags, 'organization'), []);
  assert.deepEqual(tags, ['event_organizer','collective','organization']);
  assert.equal(needsLegalCounterpartyFields(['organization']), true);
});
test('profile identity respects existing individuals and explicit kind', () => {
  assert.equal(contactProfileKind({ contact_type:['collective'] }), 'organization');
  assert.equal(contactProfileKind({ contact_type:['event_organizer'],entity_type:'individual' }), 'person');
  assert.equal(contactProfileKind({ contact_type:['event_organizer'],profile_kind:'person' }), 'person');
  assert.equal(contactProfileKind({ contact_type:['vendor'],profile_kind:'organization' }), 'organization');
  assert.equal(contactProfileKind(null), 'person');
});
test('main contact inputs require version, valid selection, and bounded person details', () => {
  assert.ok(validateMainContactRequest(null).error);
  assert.ok(validateMainContactRequest({mode:'account',expectedVersion:0,id:'bad'}).error);
  assert.ok(validateMainContactRequest({mode:'clear',expectedVersion:-1}).error);
  assert.ok(validateMainContactRequest({mode:'create',expectedVersion:0,person:{name:'Test',email:'bad'}}).error);
  assert.ok(validateMainContactRequest({mode:'create',expectedVersion:0,person:{name:'x'.repeat(201)}}).error);
  assert.equal(validateMainContactRequest({mode:'create',expectedVersion:0,person:{name:' Test ',email:'TEST@example.invalid'}}).value.person.email,'test@example.invalid');
});

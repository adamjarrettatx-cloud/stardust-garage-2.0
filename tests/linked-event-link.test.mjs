import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkedEventHref } from '../lib/linked-event-link.js';

const PUBLIC_EVENT = { id: 'evt-1', slug: 'summer-social', visibility: 'public', status: 'published' };

test('linkedEventHref: admins go to the dashboard event page', () => {
  assert.equal(linkedEventHref(PUBLIC_EVENT, true), '/bananas/events/evt-1');
});

test('linkedEventHref: admins get the dashboard page even for internal drafts', () => {
  const draft = { id: 'evt-2', slug: null, visibility: 'internal', status: 'draft' };
  assert.equal(linkedEventHref(draft, true), '/bananas/events/evt-2');
});

test('linkedEventHref: team members go to the public event page', () => {
  assert.equal(linkedEventHref(PUBLIC_EVENT, false), '/events/summer-social');
});

test('linkedEventHref: team members get no link when the event has no public page', () => {
  // /bananas/* is admin-gated by middleware, and /events/[slug] 404s these.
  assert.equal(linkedEventHref({ ...PUBLIC_EVENT, visibility: 'internal' }, false), null);
  assert.equal(linkedEventHref({ ...PUBLIC_EVENT, status: 'draft' }, false), null);
  assert.equal(linkedEventHref({ ...PUBLIC_EVENT, slug: '' }, false), null);
  assert.equal(linkedEventHref({ ...PUBLIC_EVENT, slug: null }, false), null);
});

test('linkedEventHref: missing visibility is treated as public', () => {
  assert.equal(linkedEventHref({ id: 'evt-3', slug: 'legacy' }, false), '/events/legacy');
});

test('linkedEventHref: an unresolved event never produces a link', () => {
  assert.equal(linkedEventHref(null, true), null);
  assert.equal(linkedEventHref(undefined, false), null);
  assert.equal(linkedEventHref({}, true), null);
});

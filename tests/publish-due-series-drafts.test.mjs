import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldPublishDraft } from '../lib/publish-due-series-drafts.js';

const draft = { id: 'draft-2', series_id: 'series-1', recurrence_position: 2 };

test('publishes only after a concrete prior end time has passed', () => {
  const previous = { event_date: '2026-09-10', event_time: '6:45PM - 8:45PM' };
  assert.equal(shouldPublishDraft(draft, previous, new Date('2026-09-11T01:44:59.999Z')), false);
  assert.equal(shouldPublishDraft(draft, previous, new Date('2026-09-11T01:45:00.000Z')), true);
});

test('uses the listing duration heuristic for a vague end time', () => {
  const previous = { event_date: '2026-09-10', event_time: '7 PM', event_end_time: 'late' };
  assert.equal(shouldPublishDraft(draft, previous, new Date('2026-09-11T07:59:59.999Z')), false);
  assert.equal(shouldPublishDraft(draft, previous, new Date('2026-09-11T08:00:00.000Z')), true);
});

test('uses Chicago end of day when neither time can be parsed', () => {
  const previous = { event_date: '2026-09-10', event_time: 'TBD', event_end_time: 'TBD' };
  assert.equal(shouldPublishDraft(draft, previous, new Date('2026-09-11T04:59:59.999Z')), false);
  assert.equal(shouldPublishDraft(draft, previous, new Date('2026-09-11T05:00:00.000Z')), true);
});

test('honors the Chicago DST offset at the spring boundary', () => {
  const previous = { event_date: '2026-03-08', event_time: '6 PM - 8 PM' };
  assert.equal(shouldPublishDraft(draft, previous, new Date('2026-03-09T00:59:59.999Z')), false);
  assert.equal(shouldPublishDraft(draft, previous, new Date('2026-03-09T01:00:00.000Z')), true);
});

test('does not publish when the previous sibling is absent', () => {
  assert.equal(shouldPublishDraft(draft, null, new Date('2026-09-11T08:00:00.000Z')), false);
});

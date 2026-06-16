import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickContractForSplit } from '../lib/event-financials-select.js';

const c = (status, id) => ({ id, status });

test('pickContractForSplit returns null for empty/invalid input', () => {
  assert.equal(pickContractForSplit([]), null);
  assert.equal(pickContractForSplit(null), null);
  assert.equal(pickContractForSplit(undefined), null);
});

test('pickContractForSplit prefers a signed contract over anything else', () => {
  // Ordered newest-first; the signed one is not newest but still wins.
  const linked = [c('draft', 'd'), c('signed', 's'), c('declined', 'x')];
  assert.equal(pickContractForSplit(linked).id, 's');
});

test('pickContractForSplit never lets a declined contract win over a live draft', () => {
  // Regression for the alphabetical-status bug: declined used to sort first.
  // Newest-first order with declined ahead of draft must still pick the draft.
  const linked = [c('declined', 'x'), c('draft', 'd')];
  assert.equal(pickContractForSplit(linked).id, 'd');
});

test('pickContractForSplit skips void/expired in favor of a non-dead contract', () => {
  const linked = [c('void', 'v'), c('expired', 'e'), c('pending_review', 'p')];
  assert.equal(pickContractForSplit(linked).id, 'p');
});

test('pickContractForSplit picks the most recent non-dead among several live ones', () => {
  // Newest-first: the first non-dead match is the most recent.
  const linked = [c('sent', 'newest'), c('draft', 'older')];
  assert.equal(pickContractForSplit(linked).id, 'newest');
});

test('pickContractForSplit falls back to most recent when ALL are dead', () => {
  // No signed, no live — last resort is the newest (first) of the dead set.
  const linked = [c('expired', 'newest-dead'), c('declined', 'older-dead')];
  assert.equal(pickContractForSplit(linked).id, 'newest-dead');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberDiscountCallout } from '../lib/event-discount-display.js';

test('memberDiscountCallout shows a callout for a configured percent', () => {
  assert.deepEqual(memberDiscountCallout(60), {
    show: true,
    percent: 60,
    text: 'Members get 60% OFF',
  });
});

test('memberDiscountCallout accepts numeric strings', () => {
  assert.deepEqual(memberDiscountCallout('40'), {
    show: true,
    percent: 40,
    text: 'Members get 40% OFF',
  });
  assert.deepEqual(memberDiscountCallout(' 25 '), {
    show: true,
    percent: 25,
    text: 'Members get 25% OFF',
  });
});

test('memberDiscountCallout hides when no discount is configured', () => {
  assert.deepEqual(memberDiscountCallout(null), { show: false, percent: null, text: null });
  assert.deepEqual(memberDiscountCallout(undefined), { show: false, percent: null, text: null });
  assert.deepEqual(memberDiscountCallout(''), { show: false, percent: null, text: null });
});

test('memberDiscountCallout accepts the 1 and 100 boundaries', () => {
  assert.equal(memberDiscountCallout(1).show, true);
  assert.equal(memberDiscountCallout(100).show, true);
});

test('memberDiscountCallout hides for out-of-range or non-integer percents', () => {
  assert.equal(memberDiscountCallout(0).show, false);
  assert.equal(memberDiscountCallout(101).show, false);
  assert.equal(memberDiscountCallout(-5).show, false);
  assert.equal(memberDiscountCallout(12.5).show, false);
  assert.equal(memberDiscountCallout('12.5').show, false);
});

test('memberDiscountCallout hides for junk input', () => {
  assert.equal(memberDiscountCallout('abc').show, false);
  assert.equal(memberDiscountCallout({}).show, false);
  assert.equal(memberDiscountCallout(NaN).show, false);
});

// --- memberDiscountCalloutRows ---------------------------------------------
import { memberDiscountCalloutRows } from '../lib/event-discount-display.js';

test('memberDiscountCalloutRows returns both tiers when both are set', () => {
  const rows = memberDiscountCalloutRows({
    member_discount_percent_cowork: 25,
    member_discount_percent_iykyk: 60,
  });
  assert.deepEqual(rows, [
    { key: 'cowork', label: 'The Weekender', percent: 25 },
    { key: 'iykyk',  label: 'Experience Member', percent: 60 },
  ]);
});

test('memberDiscountCalloutRows returns only the tier that is set', () => {
  assert.deepEqual(
    memberDiscountCalloutRows({ member_discount_percent_cowork: 25 }),
    [{ key: 'cowork', label: 'The Weekender', percent: 25 }],
  );
  assert.deepEqual(
    memberDiscountCalloutRows({ member_discount_percent_iykyk: 60 }),
    [{ key: 'iykyk', label: 'Experience Member', percent: 60 }],
  );
});

test('memberDiscountCalloutRows ignores legacy when any tier is set', () => {
  // Once an admin sets a per-tier value, that becomes the source of truth —
  // we do not silently mix in the legacy generic "Members" row on top.
  const rows = memberDiscountCalloutRows({
    member_discount_percent: 50,
    member_discount_percent_cowork: 25,
  });
  assert.deepEqual(rows, [{ key: 'cowork', label: 'The Weekender', percent: 25 }]);
});

test('memberDiscountCalloutRows falls back to legacy when no tier is set', () => {
  assert.deepEqual(
    memberDiscountCalloutRows({ member_discount_percent: 40 }),
    [{ key: 'legacy', label: 'Members', percent: 40 }],
  );
});

test('memberDiscountCalloutRows returns [] when nothing is set', () => {
  assert.deepEqual(memberDiscountCalloutRows({}), []);
  assert.deepEqual(memberDiscountCalloutRows(null), []);
  assert.deepEqual(memberDiscountCalloutRows({ member_discount_percent: 0 }), []);
  assert.deepEqual(
    memberDiscountCalloutRows({ member_discount_percent_cowork: '' }),
    [],
  );
});

test('memberDiscountCalloutRows accepts numeric strings for tier columns', () => {
  const rows = memberDiscountCalloutRows({
    member_discount_percent_cowork: '25',
    member_discount_percent_iykyk: ' 60 ',
  });
  assert.deepEqual(rows, [
    { key: 'cowork', label: 'The Weekender', percent: 25 },
    { key: 'iykyk',  label: 'Experience Member', percent: 60 },
  ]);
});

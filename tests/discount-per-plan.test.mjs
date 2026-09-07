import test from 'node:test';
import assert from 'node:assert/strict';

import { getDiscountPercentForPlan, CATEGORY_DISCOUNT_DEFAULTS } from '../lib/discountPercentResolver.js';

test('per-plan override wins', () => {
  const event = {
    category: 'workshop',
    member_discount_percent: 33,
    member_discount_percent_cowork: 25,
    member_discount_percent_iykyk: 75,
  };
  assert.equal(getDiscountPercentForPlan(event, 'cowork'), 25);
  assert.equal(getDiscountPercentForPlan(event, 'iykyk'), 75);
});

test('legacy shared override applies when per-plan is null', () => {
  const event = {
    category: 'workshop',
    member_discount_percent: 33,
    member_discount_percent_cowork: null,
    member_discount_percent_iykyk: null,
  };
  assert.equal(getDiscountPercentForPlan(event, 'cowork'), 33);
  assert.equal(getDiscountPercentForPlan(event, 'iykyk'), 33);
});

test('falls back to category default when nothing is set', () => {
  const event = {
    category: 'yoga',
    member_discount_percent: null,
    member_discount_percent_cowork: null,
    member_discount_percent_iykyk: null,
  };
  assert.equal(getDiscountPercentForPlan(event, 'cowork'), CATEGORY_DISCOUNT_DEFAULTS.yoga);
  assert.equal(getDiscountPercentForPlan(event, 'iykyk'), CATEGORY_DISCOUNT_DEFAULTS.yoga);
});

test('unknown / missing plan still resolves via legacy + category', () => {
  const event = {
    category: 'party',
    member_discount_percent: 42,
    member_discount_percent_cowork: 25,
    member_discount_percent_iykyk: 75,
  };
  assert.equal(getDiscountPercentForPlan(event, null), 42);
  assert.equal(getDiscountPercentForPlan(event, 'nonsense'), 42);
});

test('zero is a valid override (do not fall through)', () => {
  const event = {
    category: 'workshop',
    member_discount_percent: 60,
    member_discount_percent_cowork: 0,
    member_discount_percent_iykyk: null,
  };
  assert.equal(getDiscountPercentForPlan(event, 'cowork'), 0);
  assert.equal(getDiscountPercentForPlan(event, 'iykyk'), 60);
});

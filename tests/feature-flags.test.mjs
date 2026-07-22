import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isContractTemplatesEnabled } from '../lib/feature-flags.js';

const KEY = 'CONTRACT_TEMPLATES_ENABLED';

function withEnv(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, KEY);
  const prev = process.env[KEY];
  if (value === undefined) delete process.env[KEY];
  else process.env[KEY] = value;
  try {
    fn();
  } finally {
    if (had) process.env[KEY] = prev;
    else delete process.env[KEY];
  }
}

test('contract templates flag is OFF when the env var is unset', () => {
  withEnv(undefined, () => assert.equal(isContractTemplatesEnabled(), false));
});

test('contract templates flag is ON only for the exact string "true"', () => {
  withEnv('true', () => assert.equal(isContractTemplatesEnabled(), true));
});

test('contract templates flag stays OFF for other truthy-looking values', () => {
  for (const v of ['false', '1', 'TRUE', 'yes', 'on', '']) {
    withEnv(v, () => assert.equal(isContractTemplatesEnabled(), false, `value ${JSON.stringify(v)} should be off`));
  }
});

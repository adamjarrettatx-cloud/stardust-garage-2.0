import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveWaiverGateEnabled } from '../lib/waiver-gate.js';

test('production defaults to ENABLED (missing env var)', () => {
  assert.equal(resolveWaiverGateEnabled({ NODE_ENV: 'production' }), true);
  assert.equal(resolveWaiverGateEnabled({ VERCEL_ENV: 'production' }), true);
  assert.equal(resolveWaiverGateEnabled({
    NODE_ENV: 'production',
    VERCEL_ENV: 'production',
  }), true);
});

test('production ignores typos / unrelated values (stays ENABLED)', () => {
  for (const bad of ['', 'FALSE', 'False', '0', 'no', 'off', 'disabled', 'ture']) {
    assert.equal(
      resolveWaiverGateEnabled({ NODE_ENV: 'production', WAIVER_GATE_ENABLED: bad }),
      true,
      `production must stay ON for WAIVER_GATE_ENABLED=${JSON.stringify(bad)}`,
    );
  }
});

test('production can be explicitly bypassed with exact "false"', () => {
  assert.equal(
    resolveWaiverGateEnabled({ NODE_ENV: 'production', WAIVER_GATE_ENABLED: 'false' }),
    false,
  );
});

test('non-production (dev/preview/test) defaults to DISABLED', () => {
  for (const nodeEnv of [undefined, 'development', 'test']) {
    assert.equal(resolveWaiverGateEnabled({ NODE_ENV: nodeEnv }), false);
  }
  assert.equal(
    resolveWaiverGateEnabled({ NODE_ENV: 'development', VERCEL_ENV: 'preview' }),
    false,
  );
});

test('non-production opt-in with exact "true" turns gate ON', () => {
  assert.equal(
    resolveWaiverGateEnabled({ NODE_ENV: 'development', WAIVER_GATE_ENABLED: 'true' }),
    true,
  );
});

test('non-production ignores typos / unrelated values (stays DISABLED)', () => {
  for (const bad of ['TRUE', 'True', '1', 'yes', 'on', 'enabled']) {
    assert.equal(
      resolveWaiverGateEnabled({ NODE_ENV: 'development', WAIVER_GATE_ENABLED: bad }),
      false,
      `non-prod must stay OFF for WAIVER_GATE_ENABLED=${JSON.stringify(bad)}`,
    );
  }
});

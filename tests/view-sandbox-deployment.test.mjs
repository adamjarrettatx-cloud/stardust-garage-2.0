import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifySandboxDeployment } from '../scripts/verify-view-sandbox-deployment.mjs';

const valid = {
  VIEW_PORTAL_MODE: 'sandbox',
  NEXT_PUBLIC_SUPABASE_URL: 'https://ygcqwohfnijjaeoobwhj.supabase.co',
};
test('deployment configuration has no scheduled jobs and runs target guard', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
  assert.deepEqual(config.crons, []);
  assert.match(config.buildCommand, /^node scripts\/verify-view-sandbox-deployment.mjs &&/);
});
test('sandbox deployment guard accepts the isolated configuration', () => {
  assert.doesNotThrow(() => verifySandboxDeployment(valid));
});
test('sandbox deployment guard rejects missing or launcher mode', () => {
  assert.throws(() => verifySandboxDeployment({}));
  assert.throws(() => verifySandboxDeployment({ ...valid, VIEW_PORTAL_MODE: 'launcher' }));
});
test('sandbox deployment guard rejects production and other databases', () => {
  for (const url of ['https://iwgfelvbebqbaotkylsw.supabase.co', 'https://other.supabase.co']) {
    assert.throws(() => verifySandboxDeployment({ ...valid, NEXT_PUBLIC_SUPABASE_URL: url }));
  }
});
test('sandbox deployment guard rejects live integration credentials', () => {
  for (const name of ['STRIPE_SECRET_KEY', 'RESEND_API_KEY', 'MERCURY_TOKEN', 'CRON_SECRET']) {
    assert.throws(() => verifySandboxDeployment({ ...valid, [name]: 'test-value' }));
  }
});

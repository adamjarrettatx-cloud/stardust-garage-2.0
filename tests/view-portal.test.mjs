import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { VIEW_PERSONAS, viewPersona, personaEmail } from '../lib/view-portal/personas.js';
import { viewConfig, viewPortalStatus, PREVIEW_PROJECT_REF } from '../lib/view-portal/config.js';
import { signViewToken, verifyViewToken } from '../lib/view-portal/tokens.js';
import { sandboxFetchAllowed } from '../lib/view-portal/egress.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const ownerId = '00000000-0000-4000-8000-000000000001';
const env = {
  VIEW_PORTAL_MODE: 'sandbox', VIEW_PORTAL_READY: 'true',
  VIEW_PORTAL_ISOLATION_VERIFIED: 'true',
  VIEW_PORTAL_SANDBOX_ORIGIN: 'https://preview.example.test',
  VIEW_PORTAL_CONTROLLER_ORIGIN: 'https://sdgatx.com',
  VIEW_PORTAL_OWNER_USER_ID: ownerId, VIEW_PORTAL_SIGNING_SECRET: 'test-only-'.repeat(8),
  NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_PROJECT_REF}.supabase.co`,
  NEXT_PUBLIC_SITE_URL: 'https://preview.example.test',
};
test('catalog has unique fixed identities, never an owner persona', () => {
  assert.equal(new Set(VIEW_PERSONAS.map(p => p.id)).size, VIEW_PERSONAS.length);
  assert.equal(viewPersona('owner'), null);
  assert.throws(() => personaEmail('arbitrary-user'));
  for (const persona of VIEW_PERSONAS) {
    assert.match(personaEmail(persona.id), /@preview\.sdgatx\.invalid$/);
    assert.ok(persona.path.startsWith('/') && !persona.path.startsWith('//'));
  }
});
test('safe config pins the sandbox database and separates hostnames', () => {
  assert.equal(viewConfig(env).mode, 'sandbox');
  assert.equal(viewPortalStatus({}).ready, false);
  for (const patch of [
    { VIEW_PORTAL_READY: 'false' }, { VIEW_PORTAL_ISOLATION_VERIFIED: 'false' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://iwgfelvbebqbaotkylsw.supabase.co' },
    { NEXT_PUBLIC_SITE_URL: 'https://sdgatx.com' },
    { VIEW_PORTAL_SANDBOX_ORIGIN: 'https://sdgatx.com' },
    { VIEW_PORTAL_SANDBOX_ORIGIN: 'http://preview.example.test' },
    { VIEW_PORTAL_SIGNING_SECRET: 'short' }, { VIEW_PORTAL_OWNER_USER_ID: '' },
    { STRIPE_SECRET_KEY: 'should-not-be-here' }, { RESEND_API_KEY: 'should-not-be-here' },
  ]) assert.throws(() => viewConfig({ ...env, ...patch }));
});
const now = 1_800_000_000;
const payload = {
  purpose: 'launch', aud: env.VIEW_PORTAL_SANDBOX_ORIGIN, owner: ownerId,
  persona: 'member-artist', jti: '00000000-0000-4000-8000-000000000002',
  iat: now, exp: now + 60,
};
const options = { purpose: 'launch', audience: payload.aud, ownerId, maxAge: 60, now };
test('signed launch claims retain the exact selected persona', async () => {
  const token = await signViewToken(payload, env.VIEW_PORTAL_SIGNING_SECRET);
  assert.deepEqual(await verifyViewToken(token, env.VIEW_PORTAL_SIGNING_SECRET, options), payload);
});
test('tampering, wrong audience, wrong owner, wrong purpose and expiration fail closed', async () => {
  const token = await signViewToken(payload, env.VIEW_PORTAL_SIGNING_SECRET);
  assert.equal(await verifyViewToken(`${token}x`, env.VIEW_PORTAL_SIGNING_SECRET, options), null);
  for (const patch of [
    { audience: 'https://sdgatx.com' }, { ownerId: 'someone-else' },
    { purpose: 'session' }, { now: now + 60 }, { now: now - 30 },
  ]) assert.equal(await verifyViewToken(token, env.VIEW_PORTAL_SIGNING_SECRET, { ...options, ...patch }), null);
  const excessive = await signViewToken({ ...payload, exp: now + 1000 }, env.VIEW_PORTAL_SIGNING_SECRET);
  assert.equal(await verifyViewToken(excessive, env.VIEW_PORTAL_SIGNING_SECRET, options), null);
});
test('server egress is limited to the isolated database without functions or redirects', () => {
  assert.equal(sandboxFetchAllowed(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token`), true);
  assert.equal(sandboxFetchAllowed(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/contacts`), true);
  for (const url of [
    'https://api.stripe.com/v1/charges', 'https://api.resend.com/emails',
    'https://iwgfelvbebqbaotkylsw.supabase.co/rest/v1/events',
    `${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-push`,
    `${env.NEXT_PUBLIC_SUPABASE_URL}:8443/rest/v1/events`,
    `${env.NEXT_PUBLIC_SUPABASE_URL}.attacker.test/rest/v1/events`,
  ]) assert.equal(sandboxFetchAllowed(url), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTrialPassIntake } from '../lib/trial-pass.js';

// The account-gated ticket flow adds a Stardust-account signup route that
// mirrors /api/free-account/verify/check EXACTLY except the Twilio step is
// skipped. Because the route module imports @/... aliases that Node can't
// resolve without the Next bundler, we pin the contract by:
//
//   1. Reading the route source and asserting it uses the shared validator,
//      creates the auth user with phone_confirm:false, skips Twilio, and
//      writes phone_verified_at:null.
//   2. Exercising validateTrialPassIntake directly to prove the validation
//      shape the route relies on still rejects the invalid inputs a signup
//      form can produce.

const routeSrc = readFileSync(
  new URL('../app/api/free-account/create-no-verify/route.js', import.meta.url),
  'utf8'
);

// ---------------------------------------------------------------------------
// Route source contract
// ---------------------------------------------------------------------------

test('uses the shared validateTrialPassIntake validator', () => {
  assert.match(routeSrc, /import\s+\{[^}]*validateTrialPassIntake[^}]*\}\s+from\s+'@\/lib\/trial-pass'/);
  assert.match(routeSrc, /validateTrialPassIntake\(body\)/);
});

test('creates the Supabase user with phone captured but NOT confirmed', () => {
  // phone_confirm:false is the whole point of the "-no-verify" variant \u2014
  // if it flips to true we would be lying to Twilio-dependent code about a
  // verification that never happened.
  assert.match(routeSrc, /phone_confirm:\s*false/);
  assert.match(routeSrc, /email_confirm:\s*true/);
  assert.match(routeSrc, /phone:\s*data\.phone/);
});

test('does not import or call any Twilio helper', () => {
  // Header comments intentionally reference Twilio to document why the step
  // is skipped; check only that nothing under the code (after the last line
  // that starts with `//`) imports or invokes the helpers.
  const importsTwilio = /import[^;]+from\s+'@\/lib\/twilio-verify'/.test(routeSrc);
  assert.equal(importsTwilio, false, 'no Twilio import allowed on this path');
  assert.equal(/checkVerification\(/.test(routeSrc), false, 'checkVerification must not be called');
  assert.equal(/isTwilioVerifyConfigured\(/.test(routeSrc), false, 'the config check would gate on Twilio env even if unused otherwise');
});

test('writes free_accounts with phone_verified_at set to null', () => {
  assert.match(routeSrc, /free_accounts/);
  assert.match(routeSrc, /phone_verified_at:\s*null/);
});

test('returns 409 with an "already_registered" code on duplicate email', () => {
  assert.match(routeSrc, /status:\s*409/);
  assert.match(routeSrc, /already_registered/);
});

test('rejects passwords shorter than 8 characters with a field error', () => {
  assert.match(routeSrc, /password\.length\s*<\s*8/);
  assert.match(routeSrc, /field:\s*'password'/);
});

test('returns { ok: true, userId } on success', () => {
  assert.match(routeSrc, /ok:\s*true,\s*userId/);
});

// ---------------------------------------------------------------------------
// Validator behaviour that this route inherits
// ---------------------------------------------------------------------------

test('validation rejects an empty full name', () => {
  const { valid, field } = validateTrialPassIntake({ fullName: '', email: 'a@b.co', phone: '5125551212' });
  assert.equal(valid, false);
  assert.equal(field, 'fullName');
});

test('validation rejects a bad phone number', () => {
  const { valid, field } = validateTrialPassIntake({ fullName: 'Real Name', email: 'a@b.co', phone: '123' });
  assert.equal(valid, false);
  assert.equal(field, 'phone');
});

test('validation rejects an invalid email address', () => {
  const { valid, field } = validateTrialPassIntake({ fullName: 'Real Name', email: 'not-an-email', phone: '5125551212' });
  assert.equal(valid, false);
  assert.equal(field, 'email');
});

test('validation accepts a well-formed intake', () => {
  const res = validateTrialPassIntake({ fullName: 'Adam Jarrett', email: 'adam@Example.com', phone: '(512) 555-1212' });
  assert.equal(res.valid, true);
  assert.equal(res.data.full_name, 'Adam Jarrett');
  assert.equal(res.data.email, 'adam@example.com');
  assert.ok(res.data.phone.replace(/\D/g, '').length >= 10);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sendTrialPassProfileInvite } from '../lib/email.js';

// Front-desk trial-pass issuance now provisions the auth account that makes
// the pass worth something at checkout: lib/tickets/entitlement-lookup.js
// grants the up-to-25%-off Weekend Music entitlement from a trial_passes
// lookup keyed on user_id, so a pass with user_id = null is a door QR and
// nothing more.
//
// The route modules import '@/...' aliases that Node cannot resolve without
// the Next bundler, so the wiring is pinned against the route/lib sources
// (same technique as free-account-create-no-verify.test.mjs). The behaviour of
// the account helper itself is unit-tested for real in
// tests/trial-pass-account.test.mjs.

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const manualRouteSrc = read('../app/api/team/trial-pass/manual/route.js');
const verifyCheckSrc = read('../app/api/trial-pass/verify/check/route.js');
const redeemTrialSrc = read('../app/api/free-account/redeem-trial/route.js');
const createSrc = read('../lib/trial-pass-create.js');
const formSrc = read('../app/team/trial-pass/manual/ManualTrialPassForm.js');

// ---------------------------------------------------------------------------
// Opt-in wiring
// ---------------------------------------------------------------------------

test('the manual front-desk route opts into createAccount', () => {
  assert.match(manualRouteSrc, /issueTrialPass\(\{[\s\S]*?createAccount:\s*true[\s\S]*?\}\)/);
});

test('the manual route reports account + invite state back to the form', () => {
  for (const key of ['accountCreated', 'accountReused', 'accountLinked', 'inviteEmailed']) {
    assert.match(manualRouteSrc, new RegExp(`${key}:\\s*issued\\.${key}`), `missing ${key}`);
  }
});

test('the self-serve paths do NOT opt into createAccount', () => {
  // Anonymous public traffic creating auth users is a different decision with
  // its own abuse surface. If someone flips this on, it should be a
  // deliberate change that trips this test first.
  assert.equal(/createAccount/.test(verifyCheckSrc), false, 'verify/check must not opt in');
  assert.equal(/createAccount/.test(redeemTrialSrc), false, 'redeem-trial must not opt in');
});

test('issueTrialPass defaults createAccount to false', () => {
  assert.match(createSrc, /createAccount\s*=\s*false/);
});

// ---------------------------------------------------------------------------
// Pass-first failure isolation
// ---------------------------------------------------------------------------

test('account provisioning cannot abort the pass', () => {
  // The guest is standing at the desk waiting for a QR. ensureTrialPassAccount
  // never throws and returns { error }; the only thing issueTrialPass may do
  // with that error is log it — never return { ok: false } on it.
  const accountBlock = createSrc.slice(
    createSrc.indexOf('let account ='),
    createSrc.indexOf('let pass = null;'),
  );
  assert.ok(accountBlock.length > 0, 'account provisioning block not found');
  assert.match(accountBlock, /console\.error\('\[trial-pass\.issue\.account\]'/);
  assert.equal(/ok:\s*false/.test(accountBlock), false, 'a failed account must not fail the request');
});

test('the invite email is sent after the pass exists and swallows its failures', () => {
  const inviteFn = createSrc.slice(createSrc.indexOf('async function sendProfileInvite'));
  assert.match(inviteFn, /catch\s*\(err\)/);
  assert.match(inviteFn, /return\s*\{\s*inviteEmailed:\s*false\s*\}/);
  assert.equal(/throw /.test(inviteFn), false, 'the invite path must not throw');
  // Ordering: the pass row (and its QR) is committed before we try to email.
  assert.ok(
    createSrc.indexOf('const emailResult = await deliverPassEmail')
      < createSrc.indexOf('const invite = await sendProfileInvite'),
  );
});

test('the response carries the partial-success flags', () => {
  assert.match(createSrc, /accountCreated:\s*account\.created/);
  assert.match(createSrc, /accountReused:\s*account\.reused/);
  assert.match(createSrc, /accountLinked,/);
  assert.match(createSrc, /inviteEmailed:\s*invite\.inviteEmailed/);
});

// ---------------------------------------------------------------------------
// user_id linking rules
// ---------------------------------------------------------------------------

test('a new pass row carries user_id only when an account was resolved', () => {
  assert.match(createSrc, /if\s*\(account\.userId\)\s*insertRow\.user_id\s*=\s*account\.userId;/);
});

test('the reissue branch backfills user_id but never stomps an existing one', () => {
  assert.match(createSrc, /if\s*\(account\.userId\s*&&\s*!existing\.user_id\)\s*\{\s*\n?\s*patch\.user_id\s*=\s*account\.userId;/);
});

test('the existing-pass lookup selects user_id so the backfill can see it', () => {
  // Without user_id in the select, `!existing.user_id` is always true and the
  // guard above silently stops guarding anything.
  const lookup = createSrc.slice(createSrc.indexOf("const { data: existing"), createSrc.indexOf('maybeSingle()'));
  assert.match(lookup, /select\('id, user_id,/);
});

// ---------------------------------------------------------------------------
// Result panel copy
// ---------------------------------------------------------------------------

test('the result panel reports account and invite state, including failure', () => {
  assert.match(formSrc, /<AccountStatusLines result=\{result\} \/>/);
  assert.match(formSrc, /No account linked/);
  assert.match(formSrc, /Sign-in link did not send/);
  assert.match(formSrc, /Account created and linked to this pass/);
  assert.match(formSrc, /25% off Weekend Music Experience/);
});

test('nothing in the result panel drops below 12px', () => {
  // Adam has said this area is already hard to read. The status block is the
  // part staff has to read at a glance with a guest waiting.
  const panel = formSrc.slice(
    formSrc.indexOf('function AccountStatusLines'),
    formSrc.indexOf('function Field('),
  );
  const sizes = [...panel.matchAll(/text-\[(\d+)px\]/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length >= 3, 'expected explicit font sizes in the status block');
  for (const size of sizes) {
    assert.ok(size >= 12, `found ${size}px in the status block; 12px is the floor`);
  }
});

// ---------------------------------------------------------------------------
// The invite email itself
// ---------------------------------------------------------------------------

process.env.RESEND_API_KEY = 'test_key_not_real';

function withFetchCapture(fn) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      async json() { return { id: 'em_test' }; },
      async text() { return '{"id":"em_test"}'; },
    };
  };
  return Promise.resolve(fn(calls)).finally(() => {
    globalThis.fetch = originalFetch;
  });
}

function sentBody(calls) {
  assert.equal(calls.length, 1, 'expected exactly one outbound email');
  return JSON.parse(calls[0].init.body);
}

test('the invite email states the pass, the QR, the 25%, and the one-tap link', async () => {
  await withFetchCapture(async (calls) => {
    await sendTrialPassProfileInvite({
      email: 'jane@email.com',
      fullName: 'Jane Doe',
      profileUrl: 'https://sdgatx.com/auth/callback?token_hash=abc&type=magiclink&next=%2Faccount%2Ftickets',
      passUrl: 'https://sdgatx.com/pass/tok',
      expiresLabel: 'March 4, 2026',
    });
    const body = sentBody(calls);
    assert.deepEqual([].concat(body.to), ['jane@email.com']);
    assert.match(body.subject, /Finish setting up your Stardust Garage account/);
    assert.match(body.html, /Trial SDG Pass is active/);
    assert.match(body.html, /QR code/);
    assert.match(body.html, /up to 25% off Weekend Music Experience/);
    assert.match(body.html, /one tap, no password/);
    assert.match(body.html, /auth\/callback\?token_hash=abc/);
    assert.match(body.html, /March 4, 2026/);
  });
});

test('the invite email link is ours, never a supabase.co action link', async () => {
  await withFetchCapture(async (calls) => {
    await sendTrialPassProfileInvite({
      email: 'jane@email.com',
      fullName: 'Jane',
      profileUrl: 'https://sdgatx.com/auth/callback?token_hash=abc&type=magiclink',
    });
    assert.equal(sentBody(calls).html.includes('supabase.co'), false);
  });
});

test('the invite copy follows the house rules: no hype, no exclamation, no emoji', async () => {
  await withFetchCapture(async (calls) => {
    await sendTrialPassProfileInvite({
      email: 'jane@email.com',
      fullName: 'Jane',
      profileUrl: 'https://sdgatx.com/auth/callback?token_hash=abc',
    });
    const { html } = sentBody(calls);
    // Visible copy only — <!DOCTYPE> is not something a guest reads.
    const text = html.replace(/<[^>]*>/g, ' ');
    assert.equal(text.includes('!'), false, 'no exclamation marks');
    assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text), false, 'no emoji');
    for (const word of ['Welcome', 'excited', 'thrilled', 'Congrats', 'can\u2019t wait']) {
      assert.equal(text.toLowerCase().includes(word.toLowerCase()), false, `launch-style word: ${word}`);
    }
  });
});

test('the invite email does not leak the venue street address', async () => {
  // Standing rule (tests/email-no-venue-address.test.mjs): no template carries
  // the address. This one is delivered to someone with no account yet.
  await withFetchCapture(async (calls) => {
    await sendTrialPassProfileInvite({
      email: 'jane@email.com',
      fullName: 'Jane',
      profileUrl: 'https://sdgatx.com/auth/callback?token_hash=abc',
    });
    const { html } = sentBody(calls);
    for (const forbidden of ['4319', 'Terry-O', '78745']) {
      assert.equal(html.includes(forbidden), false, `address fragment leaked: ${forbidden}`);
    }
  });
});

test('the invite email refuses to send without a profile url', async () => {
  await assert.rejects(
    () => sendTrialPassProfileInvite({ email: 'jane@email.com', fullName: 'Jane' }),
    /requires email and profileUrl/,
  );
});

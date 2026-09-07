import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The account-gated ticket checkout removes anonymous buys entirely: a
// missing session at /api/tickets/hold is a hard 401. We can't import the
// route module directly (it uses "@/..." aliases that Node doesn't resolve
// without the Next bundler), so we assert the contract by reading the
// route source and pinning the specific patterns:
//
//   * The route requires a user resolved from getRequestUser.
//   * When user is falsy, it returns 401 with the "Sign in required" message.
//   * The buyer_email fallback for anonymous callers is GONE (no
//     buyer_email input, no "guest checkout" error string).
//
// A source-text test intentionally over-fits to the exact wording chosen in
// the PR; that's the point. If someone re-adds the guest branch or softens
// the 401 to a redirect this test fails on the exact line that changed.

const routeSrc = readFileSync(
  new URL('../app/api/tickets/hold/route.js', import.meta.url),
  'utf8'
);

test('/api/tickets/hold requires a resolved user before doing anything else', () => {
  // The call site pattern is now:
  //   const user = await getRequestUser(request);
  //   if (!user) return NextResponse.json({ error: '...' }, { status: 401 });
  const hasGetRequestUser = /const user = await getRequestUser\(request\);/.test(routeSrc);
  assert.ok(hasGetRequestUser, 'route should still resolve user via getRequestUser');

  const has401Guard = /if \(!user\)[\s\S]{0,120}NextResponse\.json\([\s\S]{0,200}status:\s*401/.test(routeSrc);
  assert.ok(has401Guard, 'route should short-circuit with status 401 when no user is present');

  const has401Message = /Sign in required to purchase tickets/.test(routeSrc);
  assert.ok(has401Message, 'the 401 body must carry the user-facing "Sign in required" copy so the front end can display it');
});

test('/api/tickets/hold no longer reads buyer_email from the request body', () => {
  // The guest branch used to parse body.buyer_email; that path is removed.
  const readsBuyerEmailInput = /body\?\.buyer_email/.test(routeSrc)
    || /buyer_email\s*=\s*typeof\s+body/.test(routeSrc);
  assert.equal(readsBuyerEmailInput, false, 'buyer_email must no longer be sourced from the request body');
});

test('/api/tickets/hold no longer references the guest-checkout error copy', () => {
  const mentionsGuestError = /guest checkout/i.test(routeSrc);
  assert.equal(mentionsGuestError, false, 'the "guest checkout" error string must be gone');
});

test('/api/tickets/hold documents the auth gate in its header comment', () => {
  // The header comment is contract too: it tells the next engineer why the
  // guest branch is gone. If someone removes the explanation, this reminds
  // them to think through the change before rewriting the flow.
  assert.match(routeSrc, /Stardust-account/i);
  assert.match(routeSrc, /401/);
});

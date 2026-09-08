import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The /pass/[token] page is the single most-viewed public artefact in the
// trial-pass flow: every guest who signs up opens it, and many keep it open
// on their phone at the door. It used to render, for an unactivated pass, a
// bold "ACTIVATE BY <60-day date>" card with the phrase "your 30 days start
// on your first visit" below it in muted text. Guests reliably read the
// bold 60-day date as their trial length. This is a wording contract that
// pins the fix in place.

const src = readFileSync(
  new URL('../app/pass/[token]/page.js', import.meta.url),
  'utf8',
);

test('unactivated live-pass card leads with the 30-day trial label', () => {
  // The branch is `live && !activated` \u2014 confirm it exists and the label
  // "30-DAY TRIAL" is inside the branch. We do not try to fully parse JSX
  // here; the surrounding block is small enough that a substring is a good
  // proxy for the visible text.
  assert.ok(
    src.includes('live && !activated'),
    'must have a distinct branch for the unactivated case',
  );
  assert.ok(
    src.includes('30-DAY TRIAL'),
    'primary card must lead with "30-DAY TRIAL" label',
  );
  assert.ok(
    src.includes('Starts on your first visit.'),
    'primary card must state the activation trigger, not the outer date',
  );
});

test('the 60-day date is demoted to a footnote and disavowed as the trial length', () => {
  // The date value we render for an unactivated pass is signup_expires_at
  // (60 days out). It is fine to show it \u2014 the QR does die then \u2014 as long
  // as we explicitly say that is the QR, not the trial.
  // JSX source uses &apos; for the apostrophe; the rendered page shows "that's".
  assert.ok(
    src.includes('that&apos;s the QR itself, not your 30-day trial'),
    'footnote must explicitly disavow the 60-day date as the trial deadline',
  );
});

test('the old ACTIVATE BY label is no longer used for unactivated passes', () => {
  // Guard against a future regression that reintroduces the old bold-date
  // pattern. `expiryLabel` still exists in the file for the activated /
  // expired branches ("GOOD THROUGH", "EXPIRED ON"), but ACTIVATE BY must
  // not appear as a rendered label anywhere.
  assert.equal(
    /ACTIVATE BY/.test(src),
    false,
    'must not render the ACTIVATE BY label',
  );
});

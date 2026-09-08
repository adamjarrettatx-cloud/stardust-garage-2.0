import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sendTrialPassDelivery,
  sendTrialPassReminder,
  sendTrialPassApplicationInvite,
} from '../lib/email.js';

// Every string a trial guest sees before they physically arrive at the venue
// runs through one of these three templates. These are the artefacts most
// likely to have their most-visible date and their footer misread by a
// stranger, so we lock the wording in with contract tests instead of trusting
// each template author to remember two independent rules:
//
//   1. The 30-day trial length must be the loudest thing the guest reads.
//      The 60-day signup_expires_at date is real (the QR does die then) but
//      the visual weight it used to have made guests think trials were 60
//      days. It is now demoted to a footnote and the surrounding copy has to
//      explicitly say "not your 30-day trial".
//
//   2. The venue street address must not appear on public trial-pass
//      artefacts. Public here means "delivered before anyone has an account".
//      Members and contractors get their own templates with their own rules;
//      trial guests do not, so the footer is contact-only.
//
// We drive the real sendEmail path by faking a RESEND_API_KEY and intercepting
// fetch — same technique as email-ticket-confirmation-shape.test.mjs — so we
// assert on the actual HTML that would ship, not on a spy return value.

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

function parseSentHtml(calls) {
  assert.equal(calls.length, 1, 'expected exactly one outbound email');
  const body = JSON.parse(calls[0].init.body);
  return body.html;
}

// The address strings we must never see in any trial-pass template. Kept as a
// list so that adding a new forbidden variant (e.g. a suite number, a zip
// prefix) in the future is a one-line change here rather than a scavenger
// hunt through the assertions below.
const FORBIDDEN_ADDRESS_STRINGS = [
  '4319',
  'Terry-O',
  '78745',
];

function assertNoVenueAddress(html, label) {
  for (const needle of FORBIDDEN_ADDRESS_STRINGS) {
    assert.equal(
      html.includes(needle),
      false,
      `${label}: must not contain venue address fragment "${needle}"`,
    );
  }
}

// ---------------------------------------------------------------------------
// Delivery — the very first email a signup gets. This is where the 60-day
// confusion originated: a bold "ACTIVATE BY <60-day date>" callout sitting
// on top of small copy that said "your 30 days start on your first visit".
// ---------------------------------------------------------------------------

test('delivery email foregrounds 30-day trial, demotes 60-day date to a footnote', async () => {
  await withFetchCapture(async (calls) => {
    await sendTrialPassDelivery({
      email: 'guest@example.com',
      fullName: 'Sam Rivera',
      passUrl: 'https://sdgatx.com/pass/abc123',
      expiresLabel: 'November 7, 2026',
    });
    const html = parseSentHtml(calls);

    // The trial length is the primary label of the callout card.
    assert.equal(html.includes('30-DAY TRIAL'), true, 'must lead with 30-DAY TRIAL');
    assert.equal(
      html.includes('Starts on your first visit'),
      true,
      'must state activation trigger in the primary card',
    );

    // The signup-window date is still present (it is a real deadline), but it
    // is framed as QR expiration and paired with an explicit disavowal.
    assert.equal(
      html.includes('November 7, 2026'),
      true,
      'must still tell the guest when the QR itself expires',
    );
    assert.equal(
      html.includes('not your 30-day trial'),
      true,
      'must explicitly say the 60-day date is not the trial length',
    );

    // The old label that caused the confusion is gone.
    assert.equal(html.includes('ACTIVATE BY'), false, 'must not use the old ACTIVATE BY heading');
  });
});

test('delivery email does not print the venue address', async () => {
  await withFetchCapture(async (calls) => {
    await sendTrialPassDelivery({
      email: 'guest@example.com',
      fullName: 'Sam Rivera',
      passUrl: 'https://sdgatx.com/pass/abc123',
      expiresLabel: 'November 7, 2026',
    });
    assertNoVenueAddress(parseSentHtml(calls), 'trial-pass delivery');
  });
});

// ---------------------------------------------------------------------------
// Reminder — activation_nudge (they signed up but never came). Same trap as
// the delivery email: it used to say "Activate by <60-day date>." bare, which
// implies the pass itself is a 60-day thing.
// ---------------------------------------------------------------------------

test('activation_nudge reframes the 60-day date as QR expiry, not trial length', async () => {
  await withFetchCapture(async (calls) => {
    await sendTrialPassReminder({
      email: 'guest@example.com',
      fullName: 'Sam Rivera',
      passUrl: 'https://sdgatx.com/pass/abc123',
      daysLeft: 42,
      expiresLabel: 'November 7, 2026',
      kind: 'activation_nudge',
    });
    const html = parseSentHtml(calls);

    // Body copy still explains the trial starts on first visit.
    assert.equal(
      html.includes("30-day trial doesn't start until your first visit"),
      true,
      'body must keep the "starts on first visit" line',
    );

    // The footnote must explicitly disambiguate: this date is the QR, not
    // the trial. The bare "Activate by <date>." line is what made people
    // read the date as the trial deadline.
    assert.equal(
      html.includes("30-day trial itself doesn't start"),
      true,
      'footnote must disavow the date as the trial deadline',
    );
    assert.equal(
      /Activate by [A-Z]/i.test(html),
      false,
      'must not use the bare "Activate by <Date>." phrasing',
    );
  });
});

test('activation_nudge does not print the venue address', async () => {
  await withFetchCapture(async (calls) => {
    await sendTrialPassReminder({
      email: 'guest@example.com',
      fullName: 'Sam Rivera',
      passUrl: 'https://sdgatx.com/pass/abc123',
      daysLeft: 42,
      expiresLabel: 'November 7, 2026',
      kind: 'activation_nudge',
    });
    assertNoVenueAddress(parseSentHtml(calls), 'activation_nudge');
  });
});

// ---------------------------------------------------------------------------
// Reminder — application_nudge (they came out, 30-day clock is ticking).
// This one already correctly refers to the 30-day window, so the only rule
// we lock in is: no venue address.
// ---------------------------------------------------------------------------

test('application_nudge does not print the venue address', async () => {
  await withFetchCapture(async (calls) => {
    await sendTrialPassReminder({
      email: 'guest@example.com',
      fullName: 'Sam Rivera',
      passUrl: 'https://sdgatx.com/pass/abc123',
      applyUrl: 'https://sdgatx.com/members',
      daysLeft: 12,
      expiresLabel: 'October 8, 2026',
      kind: 'application_nudge',
    });
    assertNoVenueAddress(parseSentHtml(calls), 'application_nudge');
  });
});

// ---------------------------------------------------------------------------
// First-arrival application invite — fires right after their first door scan.
// Same rule.
// ---------------------------------------------------------------------------

test('trial application invite does not print the venue address', async () => {
  await withFetchCapture(async (calls) => {
    await sendTrialPassApplicationInvite({
      email: 'guest@example.com',
      fullName: 'Sam Rivera',
      applyUrl: 'https://sdgatx.com/members',
      passUrl: 'https://sdgatx.com/pass/abc123',
      daysLeft: 29,
      expiresLabel: 'October 8, 2026',
    });
    assertNoVenueAddress(parseSentHtml(calls), 'trial application invite');
  });
});

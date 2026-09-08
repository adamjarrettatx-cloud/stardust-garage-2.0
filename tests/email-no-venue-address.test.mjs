import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sendUserConfirmation,
  sendMemberWelcome,
  sendPasswordReset,
  sendPartnerInvite,
  sendGuestlistGrant,
  sendTeamReply,
  sendArtistPayApproved,
  sendArtistPayRejected,
  sendContractSignatureRequest,
  sendContractCompleted,
} from '../lib/email.js';

// Standing rule: the venue street address must not appear on any email we
// send. The rule already covers public-facing artefacts (trial pass emails
// were locked down in the previous PR alongside the /pass page); this test
// extends the same guarantee to every remaining template.
//
// Anyone who genuinely needs the address can find it on the website or in
// a calendar invite; there is no reason to burn it into every automated
// email footer, and it makes leaks harder to reason about ("did we send
// them the address?") when the answer for every template is a flat "no".
//
// Same technique as email-trial-pass-shape.test.mjs: fake RESEND_API_KEY,
// intercept fetch, assert on the HTML that would actually ship.

process.env.RESEND_API_KEY = 'test_key_not_real';

const FORBIDDEN_ADDRESS_STRINGS = [
  '4319',
  'Terry-O',
  '78745',
];

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

function assertNoVenueAddress(html, label) {
  for (const needle of FORBIDDEN_ADDRESS_STRINGS) {
    assert.equal(
      html.includes(needle),
      false,
      `${label}: must not contain venue address fragment "${needle}"`,
    );
  }
}

// A helper so each template test is a one-liner. Each entry is:
//   [name, invoker(sendFn)]
// where invoker wires the send function with plausible arguments and returns
// the awaited call. Order below follows the file order of lib/email.js so
// that adding a new template puts you naturally at the bottom of this list.
const templates = [
  ['user confirmation', () => sendUserConfirmation({
    formType: 'signup',
    email: 'guest@example.com',
  })],
  ['member welcome', () => sendMemberWelcome({
    email: 'newmember@example.com',
    fullName: 'Sam Rivera',
    tempPassword: 'Temp1234!',
  })],
  ['password reset', () => sendPasswordReset({
    email: 'user@example.com',
    resetUrl: 'https://sdgatx.com/reset-password?token=abc',
  })],
  ['partner invite (non-contractor)', () => sendPartnerInvite({
    email: 'partner@example.com',
    fullName: 'Alex Kim',
    role: 'partner',
    contactTypeDisplay: 'Partner',
    activationUrl: 'https://sdgatx.com/partner/activate?token=abc',
    isContractor: false,
  })],
  ['partner invite (contractor)', () => sendPartnerInvite({
    email: 'dj@example.com',
    fullName: 'Alex Kim',
    role: 'artist',
    contactTypeDisplay: 'Artist',
    activationUrl: 'https://sdgatx.com/partner/activate?token=abc',
    isContractor: true,
  })],
  ['guest-list grant', () => sendGuestlistGrant({
    email: 'partner@example.com',
    fullName: 'Alex Kim',
    eventTitle: 'Friday Night',
    eventDate: 'Fri, Sep 12',
    freeSlots: 2,
    discountSlots: 3,
    discountDetail: '50% off',
    guestListUrl: 'https://sdgatx.com/partner/guest-list/evt',
    isUpdate: false,
  })],
  ['team reply', () => sendTeamReply({
    to: 'guest@example.com',
    subject: 'Re: question',
    bodyText: 'Thanks for reaching out.',
    senderEmail: 'adam@sdgatx.com',
    senderName: 'Adam',
  })],
  ['artist pay approved', () => sendArtistPayApproved({
    email: 'dj@example.com',
    fullName: 'Alex Kim',
    eventTitle: 'Friday Night',
    amountLabel: '$400',
    payUrl: 'https://sdgatx.com/artist/pay/req',
  })],
  ['artist pay rejected', () => sendArtistPayRejected({
    email: 'dj@example.com',
    fullName: 'Alex Kim',
    eventTitle: 'Friday Night',
    amountLabel: '$400',
    rejectionReason: 'Please attach a W-9.',
    payUrl: 'https://sdgatx.com/artist/pay/req',
  })],
  ['contract signature request', () => sendContractSignatureRequest({
    email: 'signer@example.com',
    fullName: 'Alex Kim',
    documentTitle: 'DJ Booking Agreement',
    portalUrl: 'https://sdgatx.com/contracts/doc',
    eventTitle: 'Friday Night',
    eventDate: 'Fri, Sep 12',
    deadlineLabel: 'Thu, Sep 11',
  })],
  ['contract completed', () => sendContractCompleted({
    email: 'signer@example.com',
    fullName: 'Alex Kim',
    documentTitle: 'DJ Booking Agreement',
    portalUrl: 'https://sdgatx.com/contracts/doc',
  })],
];

for (const [label, invoke] of templates) {
  test(`${label} email does not print the venue address`, async () => {
    await withFetchCapture(async (calls) => {
      await invoke();
      assertNoVenueAddress(parseSentHtml(calls), label);
    });
  });
}

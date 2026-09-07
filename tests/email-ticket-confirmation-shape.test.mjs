import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendTicketConfirmation } from '../lib/email.js';

// The ticket confirmation email is the primary artefact a buyer keeps after
// paying — the flyer hero, venue address, and "VIEW IN YOUR ACCOUNT" CTA
// live in exactly one template and every caller depends on their fields
// making it through unchanged. These tests intercept the outbound Resend
// HTTP call (there is no real network here) so we can assert on the exact
// HTML body that would ship, without touching the SMTP provider.

// Force the send path on by giving lib/email.js a fake RESEND_API_KEY.
// Without this it returns null before ever calling fetch, which would
// mask a template change under a "silent no-op" success.
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

const baseTicketRow = {
  ticketCode: 'SDG-ABC123',
  productName: 'General Admission',
  tierName: 'Early Bird',
  qrSvg: '<svg data-role="qr"></svg>',
  viewUrl: null,
};

test('sendTicketConfirmation renders the flyer <img> when eventFlyerUrl is provided', async () => {
  await withFetchCapture(async (calls) => {
    await sendTicketConfirmation({
      to: 'buyer@example.com',
      orderId: 'ord_1',
      orderDate: '2026-09-05T18:00:00Z',
      eventTitle: 'Cosmic Cabaret',
      eventWhen: '2026-09-15 at 20:00',
      eventFlyerUrl: 'https://example.com/flyer.jpg',
      venueAddress: '1610 East Cesar Chavez Street, Austin, TX 78702',
      ticketRows: [baseTicketRow],
      orderUrl: 'https://sdgatx.com/account/tickets',
    });
    const html = parseSentHtml(calls);
    assert.ok(html.includes('<img src="https://example.com/flyer.jpg"'), 'flyer img tag with the provided URL should appear');
    assert.ok(html.includes('1610 East Cesar Chavez Street'), 'venue address should render under the event line');
    assert.ok(html.includes('VIEW IN YOUR ACCOUNT'), 'account CTA button should render');
    assert.ok(html.includes('sdgatx.com/account/tickets'), 'CTA button should link to the order URL');
    assert.ok(/Ordered\s+September\s+5,\s+2026/.test(html), 'formatted order date should render');
  });
});

test('sendTicketConfirmation omits the flyer <img> when eventFlyerUrl is missing', async () => {
  await withFetchCapture(async (calls) => {
    await sendTicketConfirmation({
      to: 'buyer@example.com',
      orderId: 'ord_2',
      eventTitle: 'Comp Ticket Test',
      eventWhen: null,
      // no eventFlyerUrl, no venueAddress, no orderUrl, no orderDate
      ticketRows: [baseTicketRow],
    });
    const html = parseSentHtml(calls);
    assert.ok(!/<img\s+src=/.test(html), 'no flyer img should render when eventFlyerUrl is omitted');
    assert.ok(!html.includes('VIEW IN YOUR ACCOUNT'), 'CTA button should NOT render without orderUrl');
    assert.ok(!/Ordered\s+/.test(html), 'no ordered date row when orderDate is omitted');
  });
});

test('sendTicketConfirmation short-circuits when `to` is falsy', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };
  try {
    const result = await sendTicketConfirmation({
      to: '',
      orderId: 'ord_3',
      eventTitle: 'Nothing',
      eventWhen: null,
      ticketRows: [baseTicketRow],
    });
    assert.equal(result, null, 'should return null when no recipient');
    assert.equal(fetchCalled, false, 'must not call the mail provider');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

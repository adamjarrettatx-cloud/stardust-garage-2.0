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
  // A tiny 1x1 PNG buffer stands in for the QR bytes. sendTicketConfirmation
  // only cares that qrPngBuffer is a Buffer; it doesn't inspect contents. This
  // lets us assert the CID pipeline (attachments + <img src="cid:...">) without
  // pulling the qrcode dep into a shape test.
  qrPngBuffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]),
  viewUrl: null,
};

function parseSentPayload(calls) {
  assert.equal(calls.length, 1, 'expected exactly one outbound email');
  return JSON.parse(calls[0].init.body);
}

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

test('sendTicketConfirmation attaches one PNG per ticket with a matching cid <img>', async () => {
  await withFetchCapture(async (calls) => {
    await sendTicketConfirmation({
      to: 'buyer@example.com',
      orderId: 'ord_qr',
      eventTitle: 'QR Attachment Test',
      eventWhen: null,
      ticketRows: [
        { ...baseTicketRow, ticketCode: 'SDGA-AAAA-1111' },
        { ...baseTicketRow, ticketCode: 'SDGA-BBBB-2222' },
      ],
    });
    const payload = parseSentPayload(calls);
    assert.ok(Array.isArray(payload.attachments), 'payload must include an attachments array');
    assert.equal(payload.attachments.length, 2, 'one attachment per ticket');
    for (const att of payload.attachments) {
      assert.equal(att.content_type, 'image/png');
      assert.ok(att.filename.endsWith('.png'));
      assert.ok(att.content_id, 'attachment needs a content_id');
      assert.ok(/^[A-Za-z0-9+/=]+$/.test(att.content), 'content must be base64');
      // The template must reference this CID via <img src="cid:...">
      assert.ok(
        payload.html.includes(`cid:${att.content_id}`),
        `html should reference cid:${att.content_id}`,
      );
    }
    // And the html must NOT contain the old inline-svg leak
    assert.ok(!payload.html.includes('data:image/svg'), 'no data-URI SVG in email html');
    assert.ok(!payload.html.includes('<svg'), 'no inline SVG in email html');
    assert.ok(!payload.html.includes('null</div>'), 'no literal "null" strings in email html');
  });
});

test('sendTicketConfirmation omits the flyer <img> when eventFlyerUrl is missing', async () => {
  await withFetchCapture(async (calls) => {
    await sendTicketConfirmation({
      to: 'buyer@example.com',
      orderId: 'ord_2',
      eventTitle: 'Comp Ticket Test',
      eventWhen: null,
      // no eventFlyerUrl, no venueAddress, no orderUrl, no orderDate;
      // pass a row WITHOUT qrPngBuffer so no cid img renders either.
      ticketRows: [{ ...baseTicketRow, qrPngBuffer: null }],
    });
    const html = parseSentHtml(calls);
    assert.ok(!/<img\s+src=/.test(html), 'no img should render when both flyer and QR are omitted');
    assert.ok(!html.includes('VIEW IN YOUR ACCOUNT'), 'CTA button should NOT render without orderUrl');
    assert.ok(!/Ordered\s+/.test(html), 'no ordered date row when orderDate is omitted');
  });
});

test('sendTicketConfirmation renders quantity, unit price, subtotal, and order totals block', async () => {
  // A real paid order: 3 tickets on one line item at $10 each. The email
  // must show ONE group header ("3 tickets · $10 each · $30 subtotal"),
  // three QR rows underneath (one per ticket), and an order-totals block
  // at the bottom with subtotal / fees / tax / total paid.
  await withFetchCapture(async (calls) => {
    const line = {
      productName: 'Tickets',
      tierName: 'General',
      quantity: 3,
      unitPriceCents: 1000,
      subtotalCents: 3000,
      qrPngBuffer: baseTicketRow.qrPngBuffer,
      viewUrl: null,
    };
    await sendTicketConfirmation({
      to: 'buyer@example.com',
      orderId: 'ord_priced',
      eventTitle: 'Cosmic Cabaret',
      eventWhen: '2026-09-15 at 20:00',
      ticketRows: [
        { ...line, ticketCode: 'SDGA-AAAA-1111' },
        { ...line, ticketCode: 'SDGA-BBBB-2222' },
        { ...line, ticketCode: 'SDGA-CCCC-3333' },
      ],
      orderTotals: {
        subtotalCents: 3000,
        feesCents: 150,
        taxCents: 260,
        discountCents: 0,
        totalCents: 3410,
      },
      currency: 'usd',
    });
    const html = parseSentHtml(calls);

    // Ticket code is still present (fallback for door manual entry) but no
    // longer the ONLY thing on the row.
    assert.ok(html.includes('SDGA-AAAA-1111'), 'ticket code still rendered as a fallback');

    // Group header: product name, tier, qty, unit price, line subtotal.
    assert.ok(html.includes('Tickets — General'), 'product — tier label renders');
    assert.ok(html.includes('3 tickets'), 'quantity renders as N tickets');
    assert.ok(html.includes('$10.00 each'), 'unit price renders as "$X each"');
    assert.ok(html.includes('$30.00'), 'line subtotal renders');

    // Order totals block at the bottom.
    assert.ok(html.includes('Subtotal'), 'totals block has subtotal label');
    assert.ok(html.includes('Fees'), 'totals block has fees label when non-zero');
    assert.ok(html.includes('Tax'), 'totals block has tax label when non-zero');
    assert.ok(html.includes('Total paid'), 'totals block has total-paid label');
    assert.ok(html.includes('$34.10'), 'grand total renders in the totals block');
    assert.ok(!html.includes('Discount'), 'discount row is omitted when discount is zero');

    // Event title is prominently rendered under the "You\'re in." heading.
    assert.ok(html.includes('Cosmic Cabaret'), 'event title is rendered');
  });
});

test('sendTicketConfirmation groups tickets by line item, not per-ticket', async () => {
  // Two DIFFERENT line items: 2 General ($10) + 1 VIP ($30). Must render
  // exactly TWO group headers, not three, and not one merged row.
  await withFetchCapture(async (calls) => {
    await sendTicketConfirmation({
      to: 'buyer@example.com',
      orderId: 'ord_two_lines',
      eventTitle: 'Two Tier Show',
      eventWhen: null,
      ticketRows: [
        { ...baseTicketRow, ticketCode: 'SDGA-G-1', productName: 'Tickets', tierName: 'General', quantity: 2, unitPriceCents: 1000, subtotalCents: 2000 },
        { ...baseTicketRow, ticketCode: 'SDGA-G-2', productName: 'Tickets', tierName: 'General', quantity: 2, unitPriceCents: 1000, subtotalCents: 2000 },
        { ...baseTicketRow, ticketCode: 'SDGA-V-1', productName: 'Tickets', tierName: 'VIP', quantity: 1, unitPriceCents: 3000, subtotalCents: 3000 },
      ],
      orderTotals: { subtotalCents: 5000, feesCents: 0, taxCents: 0, discountCents: 0, totalCents: 5000 },
      currency: 'usd',
    });
    const html = parseSentHtml(calls);
    // Count the "— General" and "— VIP" labels: must appear exactly once each.
    const generalMatches = html.match(/Tickets — General/g) || [];
    const vipMatches = html.match(/Tickets — VIP/g) || [];
    assert.equal(generalMatches.length, 1, 'General group header rendered exactly once');
    assert.equal(vipMatches.length, 1, 'VIP group header rendered exactly once');
    // Both line subtotals visible.
    assert.ok(html.includes('$20.00'), 'General line subtotal $20');
    assert.ok(html.includes('$30.00'), 'VIP line subtotal $30');
    assert.ok(html.includes('$50.00'), 'order grand total $50');
  });
});

test('sendTicketConfirmation renders comp orders without pricing clutter', async () => {
  // Comp: $0 unit, $0 subtotal, $0 total. The header should show the label
  // and "N tickets" but NOT "$0.00 each" or a subtotal cell. The order
  // totals block should be omitted entirely.
  await withFetchCapture(async (calls) => {
    await sendTicketConfirmation({
      to: 'buyer@example.com',
      orderId: 'ord_comp',
      eventTitle: 'Comp Show',
      eventWhen: null,
      ticketRows: [
        { ...baseTicketRow, ticketCode: 'SDGA-COMP-1', productName: 'Tickets', tierName: 'Comp', quantity: 2, unitPriceCents: 0, subtotalCents: 0 },
        { ...baseTicketRow, ticketCode: 'SDGA-COMP-2', productName: 'Tickets', tierName: 'Comp', quantity: 2, unitPriceCents: 0, subtotalCents: 0 },
      ],
      orderTotals: { subtotalCents: 0, feesCents: 0, taxCents: 0, discountCents: 0, totalCents: 0 },
      currency: 'usd',
    });
    const html = parseSentHtml(calls);
    assert.ok(html.includes('Tickets — Comp'), 'comp label renders');
    assert.ok(html.includes('2 tickets'), 'comp quantity renders');
    assert.ok(!html.includes('$0.00 each'), 'no zero unit-price clutter');
    assert.ok(!html.includes('Total paid'), 'no totals block for fully-comped order');
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

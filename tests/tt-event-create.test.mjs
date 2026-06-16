import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dollarsToCents,
  validateTicketType,
  validateCreatePayload,
  buildEventSeriesBody,
  buildTicketTypeBody,
  extractSeriesPublicUrl,
} from '../lib/tt-event-create.js';

test('dollarsToCents converts major units to integer cents', () => {
  assert.equal(dollarsToCents('12.50'), 1250);
  assert.equal(dollarsToCents(10), 1000);
  assert.equal(dollarsToCents('0'), 0);
  assert.equal(dollarsToCents(0), 0);
});

test('dollarsToCents rounds without float drift', () => {
  assert.equal(dollarsToCents('12.34'), 1234);
  assert.equal(dollarsToCents(19.99), 1999);
});

test('dollarsToCents maps blank to null and junk/negatives to NaN', () => {
  assert.equal(dollarsToCents(''), null);
  assert.equal(dollarsToCents(null), null);
  assert.equal(dollarsToCents(undefined), null);
  assert.ok(Number.isNaN(dollarsToCents('abc')));
  assert.ok(Number.isNaN(dollarsToCents('-5')));
});

test('validateTicketType accepts a full valid row', () => {
  const res = validateTicketType({ name: 'GA', price: '25', quantity: '100', description: 'x' }, 0);
  assert.deepEqual(res, {
    ok: true,
    value: { name: 'GA', priceCents: 2500, quantity: 100, description: 'x' },
  });
});

test('validateTicketType allows free tickets and unlimited quantity', () => {
  const res = validateTicketType({ name: 'Free', price: '0', quantity: '' }, 0);
  assert.equal(res.ok, true);
  assert.equal(res.value.priceCents, 0);
  assert.equal(res.value.quantity, null);
  assert.equal(res.value.description, null);
});

test('validateTicketType rejects missing name, bad price, bad quantity', () => {
  assert.equal(validateTicketType({ name: '', price: '5' }, 0).ok, false);
  assert.equal(validateTicketType({ name: 'x', price: '' }, 0).ok, false);
  assert.equal(validateTicketType({ name: 'x', price: 'abc' }, 0).ok, false);
  assert.equal(validateTicketType({ name: 'x', price: '5', quantity: '0' }, 0).ok, false);
  assert.equal(validateTicketType({ name: 'x', price: '5', quantity: '1.5' }, 0).ok, false);
  assert.equal(validateTicketType({ name: 'x', price: '5', quantity: '-3' }, 0).ok, false);
});

test('validateTicketType error message is 1-indexed', () => {
  const res = validateTicketType({ name: '', price: '5' }, 2);
  assert.match(res.error, /Ticket type 3/);
});

function basePayload(overrides = {}) {
  return {
    title: 'Cosmic Disco',
    slug: 'cosmic-disco',
    event_date: '2026-07-04',
    event_time: '10:00 PM',
    description: 'A party',
    category: 'party',
    ticket_types: [{ name: 'GA', price: '20', quantity: '150' }],
    ...overrides,
  };
}

test('validateCreatePayload accepts a well-formed payload', () => {
  const res = validateCreatePayload(basePayload());
  assert.equal(res.ok, true);
  assert.equal(res.value.title, 'Cosmic Disco');
  assert.equal(res.value.slug, 'cosmic-disco');
  assert.equal(res.value.ticketTypes.length, 1);
  assert.equal(res.value.ticketTypes[0].priceCents, 2000);
});

test('validateCreatePayload requires title, slug, date', () => {
  assert.equal(validateCreatePayload(basePayload({ title: '' })).ok, false);
  assert.equal(validateCreatePayload(basePayload({ slug: '' })).ok, false);
  assert.equal(validateCreatePayload(basePayload({ slug: 'Bad Slug!' })).ok, false);
  assert.equal(validateCreatePayload(basePayload({ event_date: '07/04/2026' })).ok, false);
  assert.equal(validateCreatePayload(basePayload({ event_date: '' })).ok, false);
});

test('validateCreatePayload requires at least one ticket type', () => {
  const res = validateCreatePayload(basePayload({ ticket_types: [] }));
  assert.equal(res.ok, false);
  assert.match(res.error, /at least one ticket type/);
});

test('validateCreatePayload propagates a bad ticket type error', () => {
  const res = validateCreatePayload(basePayload({ ticket_types: [{ name: '', price: '5' }] }));
  assert.equal(res.ok, false);
  assert.match(res.error, /name is required/);
});

test('validateCreatePayload validates member discount percent range', () => {
  assert.equal(validateCreatePayload(basePayload({ member_discount_percent: '60' })).ok, true);
  assert.equal(validateCreatePayload(basePayload({ member_discount_percent: '0' })).ok, false);
  assert.equal(validateCreatePayload(basePayload({ member_discount_percent: '101' })).ok, false);
  assert.equal(validateCreatePayload(basePayload({ member_discount_percent: '12.5' })).ok, false);
  // Blank is allowed (no discount).
  assert.equal(validateCreatePayload(basePayload({ member_discount_percent: '' })).ok, true);
});

test('buildEventSeriesBody always creates a draft with name/currency/date', () => {
  const body = buildEventSeriesBody({
    title: 'Cosmic Disco',
    eventDate: '2026-07-04',
    eventTime: '10:00 PM',
    description: 'A party',
  });
  assert.equal(body.get('name'), 'Cosmic Disco');
  assert.equal(body.get('status'), 'draft');
  assert.equal(body.get('currency'), 'USD');
  assert.equal(body.get('description'), 'A party');
  assert.equal(body.get('start_date[date]'), '2026-07-04');
  assert.equal(body.get('start_date[time]'), '10:00 PM');
});

test('buildEventSeriesBody omits time when not provided', () => {
  const body = buildEventSeriesBody({ title: 'X', eventDate: '2026-07-04', eventTime: null });
  assert.equal(body.get('start_date[time]'), null);
});

test('buildTicketTypeBody sends price in cents and omits unlimited quantity', () => {
  const unlimited = buildTicketTypeBody({ name: 'GA', priceCents: 2000, quantity: null });
  assert.equal(unlimited.get('name'), 'GA');
  assert.equal(unlimited.get('price'), '2000');
  assert.equal(unlimited.get('quantity'), null);

  const capped = buildTicketTypeBody({ name: 'VIP', priceCents: 5000, quantity: 50, description: 'd' });
  assert.equal(capped.get('quantity'), '50');
  assert.equal(capped.get('description'), 'd');
});

test('extractSeriesPublicUrl reads the url field from a series object', () => {
  assert.equal(
    extractSeriesPublicUrl({ id: 'es_1', url: 'https://buytickets.at/x/y' }),
    'https://buytickets.at/x/y',
  );
});

test('extractSeriesPublicUrl accepts documented aliases', () => {
  assert.equal(
    extractSeriesPublicUrl({ checkout_url: 'https://www.tickettailor.com/events/x' }),
    'https://www.tickettailor.com/events/x',
  );
  assert.equal(
    extractSeriesPublicUrl({ public_url: 'http://example.com/e' }),
    'http://example.com/e',
  );
});

test('extractSeriesPublicUrl trims surrounding whitespace', () => {
  assert.equal(extractSeriesPublicUrl({ url: '  https://x.com/e  ' }), 'https://x.com/e');
});

test('extractSeriesPublicUrl returns null for missing/non-object/non-http values', () => {
  assert.equal(extractSeriesPublicUrl(null), null);
  assert.equal(extractSeriesPublicUrl(undefined), null);
  assert.equal(extractSeriesPublicUrl('https://x.com'), null); // not an object
  assert.equal(extractSeriesPublicUrl({ id: 'es_1' }), null); // no url field
  assert.equal(extractSeriesPublicUrl({ url: '' }), null);
  assert.equal(extractSeriesPublicUrl({ url: 'es_1234567' }), null); // not a URL
  assert.equal(extractSeriesPublicUrl({ url: 'javascript:alert(1)' }), null); // non-http scheme
  assert.equal(extractSeriesPublicUrl({ url: 123 }), null); // non-string
});

test('extractSeriesPublicUrl prefers url over aliases', () => {
  assert.equal(
    extractSeriesPublicUrl({ url: 'https://a.com', checkout_url: 'https://b.com' }),
    'https://a.com',
  );
});

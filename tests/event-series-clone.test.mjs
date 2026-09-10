import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNextOccurrenceEvent, buildNextTicketProductPayload } from '../lib/event-series.js';

const template = { title: 'Yoga', slug: 'yoga', status: 'published', visibility: 'public', event_time: '7 PM', ticketing_mode: 'internal', member_discount_percent_cowork: 20, member_discount_percent_iykyk: 10 };

test('event clone uses a dated slug, fresh token, draft status, and next position', () => {
  const row = buildNextOccurrenceEvent(template, { eventDate: '2026-09-16', seriesId: 'series-1', recurrencePosition: 2, shareToken: 'fresh-token' });
  assert.equal(row.slug, 'yoga-2026-09-16');
  assert.equal(row.share_token, 'fresh-token');
  assert.equal(row.status, 'draft');
  assert.equal(row.recurrence_position, 2);
  assert.equal(row.member_discount_percent_cowork, 20);
});

test('ticket product clone preserves pricing tiers and resets inventory counters', () => {
  const payload = buildNextTicketProductPayload({ name: 'General', kind: 'tickets', is_active: true }, { capacity: 100, sold: 9, reserved: 1 }, [{ name: 'Member', price_cents: 1800, access_codes: ['MEMBER'], quantity: 40 }], 'event-2');
  assert.deepEqual(payload.inventory, { capacity: 100, sold: 0, reserved: 0 });
  assert.equal(payload.product.event_id, 'event-2');
  assert.equal(payload.tiers[0].price_cents, 1800);
  assert.deepEqual(payload.tiers[0].access_codes, ['MEMBER']);
});

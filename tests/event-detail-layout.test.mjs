import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const detail = readFileSync(
  new URL('../app/events/_components/EventDetail.jsx', import.meta.url),
  'utf8',
);

test('shared event detail omits the redundant venue block', () => {
  assert.doesNotMatch(detail, />\s*Venue\s*</);
  assert.doesNotMatch(detail, /Stardust Garage<br|St\. Elmo Arts District|Austin, TX 78745/);
});

test('event detail preserves time, about, and ticket actions', () => {
  assert.match(detail, /formatEventTime\(event\.event_time, event\.event_end_time\)/);
  assert.match(detail, /order-6 py-5 border-t[\s\S]*>\s*About\s*</);
  assert.match(detail, /\{event\.description\}/);
  assert.match(detail, /<InternalTicketModal/);
  assert.match(detail, /BUY TICKETS/);
  assert.ok(detail.indexOf('                Time\n') < detail.indexOf('              About\n'));
});

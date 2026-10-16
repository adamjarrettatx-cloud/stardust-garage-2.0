import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('nightly cron no longer pulls Ticket Tailor discovered events', () => {
  const crons = JSON.parse(read('vercel.json')).crons.map((c) => c.path);
  assert.ok(!crons.includes('/api/admin/refresh-tt-discovered'));
  assert.ok(crons.includes('/api/admin/refresh-event-metrics'), 'internal sales refresh stays scheduled');
});

for (const rel of [
  'app/api/admin/refresh-tt-discovered/route.js',
  'app/api/admin/events/[id]/tt-link/route.js',
  'app/api/admin/tt-event-series/route.js',
  'app/api/admin/backfill-tt-orders/route.js',
  'app/api/admin/events/create-with-tt/route.js',
]) {
  test(`${rel} is frozen and makes no Ticket Tailor calls`, () => {
    const src = read(rel);
    assert.match(src, /ticketTailorFrozenResponse/);
    assert.doesNotMatch(src, /lib\/tickettailor'/);
    assert.doesNotMatch(src, /\.from\(/);
  });
}

test('Ticket Tailor webhook acknowledges without writing', () => {
  const src = read('app/api/webhooks/tickettailor/route.js');
  assert.match(src, /tickettailor_retired/);
  assert.doesNotMatch(src, /\.from\(|upsert|insert|sendPush|mailchimp/i);
});

test('old Event Financials page redirects to the Write-Up and its POS import is gone', () => {
  assert.match(read('app/bananas/events/[id]/financials/page.js'), /\/writeup`\)/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'app/api/admin/events/[id]/pos-import')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'app/api/admin/events/[id]/financials')));
  assert.doesNotMatch(read('app/bananas/events/[id]/page.js'), />\s*FINANCIALS\s*</);
});

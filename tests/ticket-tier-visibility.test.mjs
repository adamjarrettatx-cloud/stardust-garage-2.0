import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectTiersForBuyer, selectActiveTier } from '../lib/tickets/pricing.js';

const now = new Date('2026-10-01T15:00:00Z');
function ladder() {
  return [
    { id: 'early', name: 'Early Bird', status: 'hidden', is_active: false, display_order: 0, quantity: 20, sold_count: 18, price_cents: 1500 },
    { id: 'one', name: 'Tier 1', status: 'active', display_order: 0, quantity: 20, sold_count: 1, price_cents: 2000 },
    { id: 'two', name: 'Tier 2', status: 'active', display_order: 1, quantity: 30, sold_count: 0, price_cents: 2500 },
    { id: 'three', name: 'Tier 3', status: 'active', display_order: 2, quantity: 40, sold_count: 0, price_cents: 3000 },
    { id: 'door', name: 'Door', status: 'active', display_order: 3, quantity: null, price_cents: 4000 },
  ];
}

function assertCurrent(tiers, id, options = {}) {
  const projected = projectTiersForBuyer(tiers, { now, ...options });
  assert.equal(selectActiveTier(tiers, { now, ...options })?.id ?? null, id);
  assert.deepEqual(projected.map((t) => t.id), id ? [id] : []);
  for (const tier of projected) {
    assert.equal(tier.visible, true);
    assert.equal(tier.buyable, true);
    assert.equal(tier.reveal_gated, false);
  }
}

test('unlimited product inventory does not expose future tier names or prices', () => {
  assertCurrent(ladder(), 'one', { remainingInventory: null, revealThreshold: 10 });
});

for (const remaining of [19, 10, 1]) {
  test(`only current tier is public with ${remaining} tickets remaining`, () => {
    const tiers = ladder();
    tiers[1].sold_count = 20 - remaining;
    assertCurrent(tiers, 'one', { remainingInventory: remaining, revealThreshold: 10 });
  });
}

test('legacy unset threshold never exposes the ladder', () => {
  assertCurrent(ladder(), 'one', { revealThreshold: null });
});

test('selling out current tier replaces it with next Active tier only', () => {
  const tiers = ladder();
  tiers[1].sold_count = 20;
  assertCurrent(tiers, 'two');
});

test('reserving the remaining stock selects only the next eligible tier', () => {
  const tiers = ladder();
  tiers[1].reserved_count = 19;
  assertCurrent(tiers, 'two');
});

test('hard removal advances to next Active tier without changing input data', () => {
  const tiers = ladder().filter((t) => t.id !== 'one');
  const original = structuredClone(tiers);
  assertCurrent(tiers, 'two');
  assert.deepEqual(tiers, original);
});

test('soft removal preserves sold history but does not expose the removed tier', () => {
  const tiers = ladder();
  tiers[1].is_active = false;
  tiers[1].status = 'hidden';
  assertCurrent(tiers, 'two');
  assert.equal(tiers[1].sold_count, 1);
});

test('manual sold-out status advances; hidden and locked code tiers stay private', () => {
  const tiers = ladder();
  tiers[1].status = 'sold_out';
  tiers[2].status = 'hidden';
  tiers[3].status = 'access_code';
  tiers[3].access_codes = ['SECRET'];
  assertCurrent(tiers, 'door');
});

test('future and expired sale windows never leak non-current tiers', () => {
  const tiers = ladder();
  tiers[1].ends_at = '2026-10-01T14:00:00Z';
  tiers[2].starts_at = '2026-10-02T15:00:00Z';
  assertCurrent(tiers, 'three');
});

test('no eligible tier returns no public tier prices', () => {
  assertCurrent(ladder().map((t) => ({ ...t, status: 'hidden' })), null);
  assertCurrent([], null);
  assertCurrent(null, null);
});

test('duplicate display orders still expose exactly the selected tier', () => {
  const tiers = ladder();
  tiers[2].display_order = 0;
  assertCurrent(tiers, 'one');
});

test('unlocked code tier remains available without revealing any later tiers', () => {
  const tiers = [
    { id: 'code', status: 'access_code', access_codes: ['SECRET'], quantity: 20 },
    { id: 'later', status: 'active', starts_at: '2026-10-02T15:00:00Z' },
  ];
  assertCurrent(tiers, null);
  assertCurrent(tiers, 'code', { unlockedCodes: ['secret'] });
});

test('buyer widget has no coming-next renderer, even with an older API response', () => {
  const widget = readFileSync(new URL('../app/events/_components/InternalTicketPurchase.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(widget, /Coming next:|p\.tiers\s*&&|\.filter\(\(t\) => !t\.buyable\)/);
});

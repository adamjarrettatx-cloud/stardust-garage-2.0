import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { MEMBERSHIP_TIER_LIST, TRIAL_PASS_PRICING, resolveTicketDiscountPercent } from '../lib/membership-tiers.js';
import { memberDiscountCalloutRows } from '../lib/event-discount-display.js';
import { discountedCheckoutLines } from '../lib/tickets/checkout-lines.js';
import { buildNextOccurrenceEvent } from '../lib/event-series.js';

for (const tier of MEMBERSHIP_TIER_LIST) {
  test(`${tier.key}: explicit eligible weeknight guarantees 20%, preserving higher overrides and caps`, () => {
    for (const override of [undefined, null, '', 0, 5, 19, 20, 30, 60, 100, 200]) {
      const event = { is_weeknight_experience: true, [tier.discountColumn]: override };
      assert.equal(resolveTicketDiscountPercent(event, tier), Math.min(tier.ticketDiscount.maxPercent, Math.max(20, Number(override) || 0)));
    }
  });
}
test('no calendar/title/category inference; legacy shared percentage cannot price an internal event', () => {
  const event = { ticketing_mode: 'internal', title: 'Wellness Wednesday', event_date: '2026-09-30', category: 'wellness', member_discount_percent: 20 };
  for (const tier of MEMBERSHIP_TIER_LIST) assert.equal(resolveTicketDiscountPercent(event, tier), 0);
  assert.deepEqual(memberDiscountCalloutRows(event), []);
});
test('trial benefit is unchanged and classifications never stack', () => {
  const event = { is_weeknight_experience: true };
  assert.equal(resolveTicketDiscountPercent(event, TRIAL_PASS_PRICING), 0);
  event.is_weekend_music_experience = true;
  assert.equal(resolveTicketDiscountPercent(event, TRIAL_PASS_PRICING), 25);
  assert.equal(resolveTicketDiscountPercent(event, MEMBERSHIP_TIER_LIST[0]), 25);
});
test('internal callouts equal checkout resolution; external flags do not invent a 20% provider benefit', () => {
  const event = { ticketing_mode: 'internal', is_weeknight_experience: true, member_discount_percent_iykyk: 90 };
  assert.deepEqual(memberDiscountCalloutRows(event).map(row => row.percent), [20, 20, 60]);
  assert.deepEqual(memberDiscountCalloutRows({ ...event, ticketing_mode: 'external', member_discount_percent_iykyk: null }), []);
});
test('next recurring draft inherits explicit eligibility and missing values safely default false', () => {
  const options = { eventDate: '2026-10-07', seriesId: 's', recurrencePosition: 2, shareToken: 'private' };
  assert.equal(buildNextOccurrenceEvent({ is_weeknight_experience: true }, options).is_weeknight_experience, true);
  assert.equal(buildNextOccurrenceEvent({}, options).is_weeknight_experience, false);
  assert.equal(buildNextOccurrenceEvent({ is_weeknight_experience: true }, options).status, 'draft');
});

const products = new Map([['t', { kind: 'tickets' }], ['r', { kind: 'private_space' }]]);
const total = lines => lines.reduce((sum, line) => sum + line.unit_price_cents * line.quantity, 0);
test('Stripe allocation conserves cents and quantities across mixed rental orders (10,000 combinations)', () => {
  for (let price = 1; price <= 100; price++) {
    for (let qty = 1; qty <= 10; qty++) {
      for (const pct of [0, 1, 5, 19, 20, 25, 33, 60, 99, 100]) {
        const items = [{ product_id: 't', unit_price_cents: price, quantity: qty }, { product_id: 'r', unit_price_cents: 10000, quantity: 2 }];
        const before = structuredClone(items);
        const discountCents = Math.floor(price * qty * pct / 100);
        const lines = discountedCheckoutLines({ items, discountCents, discountSource: 'entitlement' }, products);
        assert.equal(total(lines), total(items) - discountCents);
        assert.deepEqual(lines.find(line => line.product_id === 'r'), items[1]);
        assert.equal(lines.filter(line => line.product_id === 't').reduce((n, line) => n + line.quantity, 0), qty);
        assert.ok(lines.every(line => Number.isInteger(line.unit_price_cents) && line.unit_price_cents >= 0));
        assert.deepEqual(items, before);
      }
    }
  }
});
test('a product-scoped promo stays scoped, including one-cent discounts on multi-quantity lines', () => {
  const items = [{ product_id: 't', unit_price_cents: 101, quantity: 3 }, { product_id: 'r', unit_price_cents: 10000, quantity: 1 }];
  const lines = discountedCheckoutLines({ items, discountCents: 1, discountSource: 'code' }, products, { applies_to: 'specific', product_ids: ['t'] });
  assert.equal(total(lines), 10302);
  assert.deepEqual(lines.find(line => line.product_id === 'r'), items[1]);
  assert.throws(() => discountedCheckoutLines({ items, discountCents: 304, discountSource: 'code' }, products, { applies_to: 'specific', product_ids: ['t'] }), /Invalid/);
});
test('migration is additive, idempotent, defaults existing events false and preserves RLS policy', async () => {
  const db = new PGlite();
  try {
    await db.exec("create table public.events(id text primary key); insert into events values ('existing'); alter table events enable row level security; create policy published_read on events for select using (true);");
    const sql = readFileSync(new URL('../supabase/migrations/20260930140000_weeknight_member_benefit.sql', import.meta.url), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    assert.deepEqual((await db.query('select * from events')).rows, [{ id: 'existing', is_weeknight_experience: false }]);
    await db.exec("insert into events (id) values ('new');");
    assert.equal((await db.query("select is_weeknight_experience from events where id='new'")).rows[0].is_weeknight_experience, false);
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.events'::regclass")).rows[0].relrowsecurity, true);
    assert.equal((await db.query("select count(*)::int as n from pg_policies where tablename='events'")).rows[0].n, 1);
    await assert.rejects(db.exec("update events set is_weeknight_experience = null;"), /not-null/);
  } finally { await db.close(); }
});

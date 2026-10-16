import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  LEFT_DOOR_DEFAULT_DESCRIPTION,
  LEFT_DOOR_DEFAULT_IMAGE_URL,
  isLeftDoor,
  leftDoorState,
} from '../lib/left-door.js';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261016020000_left_door_default_private_space.sql', import.meta.url),
  'utf8',
);

const tier = (price_cents, extra = {}) => ({ id: 't', price_cents, status: 'active', is_active: true, ...extra });
const base = { id: 'p', system_key: 'left_door', kind: 'private_space', is_active: true, sold_count: 0 };

test('Left Door state: new rows need a price before they sell', () => {
  assert.equal(leftDoorState({ ...base, tiers: [] }), 'needs_price');
  assert.equal(leftDoorState({ ...base, tiers: [tier(0)] }), 'needs_price');
  assert.equal(leftDoorState({ ...base, tiers: [tier(80000, { status: 'hidden' })] }), 'needs_price');
  assert.equal(leftDoorState({ ...base, tiers: [tier(80000)] }), 'selling');
  assert.equal(leftDoorState({ ...base, tiers: [tier(80000)], sold_count: 1 }), 'sold');
  assert.equal(leftDoorState({ ...base, is_active: false, tiers: [tier(80000)] }), 'off');
  assert.equal(leftDoorState(null), 'missing');
  assert.equal(isLeftDoor(base), true);
  assert.equal(isLeftDoor({ ...base, system_key: null }), false);
});

test('database defaults match the editor defaults', () => {
  assert.ok(migration.includes(`'${LEFT_DOOR_DEFAULT_DESCRIPTION}'`));
  assert.ok(migration.includes(`'${LEFT_DOOR_DEFAULT_IMAGE_URL}'`));
});

test('migration: one per event, capacity 1, no price tier, trigger on every new event', () => {
  assert.match(migration, /create unique index if not exists ticket_products_one_left_door_per_event[\s\S]*where system_key = 'left_door'/);
  assert.match(migration, /values \(v_product_id, 1, 0, 0\)/);
  assert.doesNotMatch(migration, /insert into public\.ticket_price_tiers/);
  assert.match(migration, /after insert on public\.events[\s\S]*events_add_left_door/);
  assert.match(migration, /revoke all on function public\.ensure_left_door_private_space\(uuid\) from anon, authenticated/);
  assert.match(migration, /event_date >= \(now\(\) at time zone 'America\/Chicago'\)::date/);
});

test('buyers never see an unpriced Left Door', () => {
  const src = fs.readFileSync(new URL('../app/api/tickets/availability/route.js', import.meta.url), 'utf8');
  assert.match(src, /p\.system_key === 'left_door' && !\(tiersByProduct\.get\(p\.id\) \|\| \[\]\)\.length/);
});

test('Left Door cannot be deleted and keeps a fixed shape', () => {
  const src = fs.readFileSync(new URL('../app/api/admin/tickets/products/route.js', import.meta.url), 'utf8');
  assert.match(src, /target\?\.system_key === 'left_door'/);
  assert.match(src, /if \(isLeftDoor\) \{\s*capValue = 1;/);
  assert.match(src, /max_per_order: isLeftDoor \? 1 : max_per_order/);
});

test('series copies reuse the auto-created Left Door instead of inserting a duplicate', () => {
  const src = fs.readFileSync(new URL('../lib/series-generation.js', import.meta.url), 'utf8');
  assert.match(src, /source\.system_key === 'left_door'[\s\S]*\.eq\('system_key', 'left_door'\)[\s\S]*continue;/);
});

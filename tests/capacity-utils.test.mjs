import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampCount,
  parseMaxCapacity,
  deriveStatus,
  mapRpcError,
  isValidSource,
  CAPACITY_OPERATIONS,
  NEAR_FULL_RATIO,
} from '../lib/capacity-utils.js';

test('clampCount keeps count within [0, max]', () => {
  assert.equal(clampCount(5, 100), 5);
  assert.equal(clampCount(-3, 100), 0);
  assert.equal(clampCount(150, 100), 100);
  assert.equal(clampCount(5.7, 100), 6);
});

test('clampCount handles bad input gracefully', () => {
  assert.equal(clampCount('abc', 100), 0);
  assert.equal(clampCount(NaN, 100), 0);
  assert.equal(clampCount(10, 0), 10); // no usable max -> just floor at 0
  assert.equal(clampCount(-1, 0), 0);
});

test('parseMaxCapacity accepts positive integers only', () => {
  assert.equal(parseMaxCapacity(100), 100);
  assert.equal(parseMaxCapacity('250'), 250);
  assert.equal(parseMaxCapacity(0), null);
  assert.equal(parseMaxCapacity(-5), null);
  assert.equal(parseMaxCapacity(1.5), null);
  assert.equal(parseMaxCapacity('abc'), null);
  assert.equal(parseMaxCapacity(200001), null);
});

test('deriveStatus returns none for a null session', () => {
  const r = deriveStatus(null);
  assert.equal(r.status, 'none');
  assert.equal(r.count, 0);
  assert.equal(r.atZero, true);
});

test('deriveStatus computes empty/open/near/full', () => {
  assert.equal(deriveStatus({ current_count: 0, max_capacity: 100 }).status, 'empty');
  assert.equal(deriveStatus({ current_count: 40, max_capacity: 100 }).status, 'open');
  assert.equal(deriveStatus({ current_count: 90, max_capacity: 100 }).status, 'near');
  assert.equal(deriveStatus({ current_count: 100, max_capacity: 100 }).status, 'full');
});

test('deriveStatus near threshold matches NEAR_FULL_RATIO', () => {
  const justUnder = deriveStatus({ current_count: 89, max_capacity: 100 });
  const atThreshold = deriveStatus({ current_count: Math.ceil(NEAR_FULL_RATIO * 100), max_capacity: 100 });
  assert.equal(justUnder.status, 'open');
  assert.equal(atThreshold.status, 'near');
});

test('deriveStatus clamps an over-max stored count to full', () => {
  const r = deriveStatus({ current_count: 130, max_capacity: 100 });
  assert.equal(r.count, 100);
  assert.equal(r.status, 'full');
  assert.equal(r.remaining, 0);
  assert.equal(r.atMax, true);
});

test('deriveStatus reports remaining spots', () => {
  const r = deriveStatus({ current_count: 30, max_capacity: 100 });
  assert.equal(r.remaining, 70);
});

test('isValidSource validates against the source whitelist', () => {
  assert.equal(isValidSource('front_door'), true);
  assert.equal(isValidSource('exit_door'), true);
  assert.equal(isValidSource('hacker'), false);
  assert.equal(isValidSource(undefined), false);
});

test('mapRpcError maps the auth / business errors to stable codes', () => {
  assert.equal(mapRpcError({ code: '42501' }).code, 'forbidden');
  assert.equal(mapRpcError({ message: 'Not authorized' }).code, 'forbidden');
  assert.equal(mapRpcError({ code: 'P0002' }).code, 'no_session');
  assert.equal(mapRpcError({ message: 'At capacity' }).code, 'full');
  assert.equal(mapRpcError({ message: 'Already empty' }).code, 'empty');
  assert.equal(mapRpcError({ message: 'max_capacity must be positive' }).code, 'bad_input');
});

test('mapRpcError carries appropriate http status codes', () => {
  assert.equal(mapRpcError({ code: '42501' }).httpStatus, 403);
  assert.equal(mapRpcError({ code: 'P0002' }).httpStatus, 409);
  assert.equal(mapRpcError({ message: 'At capacity' }).httpStatus, 409);
  assert.equal(mapRpcError({ message: 'something weird' }).httpStatus, 500);
});

test('CAPACITY_OPERATIONS dispatch table enforces correct roles', () => {
  assert.equal(CAPACITY_OPERATIONS.check_in.role, 'team');
  assert.equal(CAPACITY_OPERATIONS.check_out.role, 'team');
  assert.equal(CAPACITY_OPERATIONS.reset.role, 'team');
  assert.equal(CAPACITY_OPERATIONS.adjust.role, 'admin');
  assert.equal(CAPACITY_OPERATIONS.start.role, 'admin');
  assert.equal(CAPACITY_OPERATIONS.end.role, 'admin');
});

test('CAPACITY_OPERATIONS map to the expected RPC names', () => {
  assert.equal(CAPACITY_OPERATIONS.check_in.rpc, 'capacity_check_in');
  assert.equal(CAPACITY_OPERATIONS.check_out.rpc, 'capacity_check_out');
  assert.equal(CAPACITY_OPERATIONS.start.rpc, 'capacity_start_session');
  assert.equal(CAPACITY_OPERATIONS.end.rpc, 'capacity_end_session');
});
